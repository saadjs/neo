import { getLogger } from "../logging/index";
import type {
  ConversationRef,
  OutboundTransport,
  UserInputPromptHandle,
  UserInputRequest,
  UserInputResponse,
} from "./types";
import { buildConversationKey } from "./types";

export class PendingUserInputCancelledError extends Error {
  constructor(message = "User input request cancelled.") {
    super(message);
    this.name = "PendingUserInputCancelledError";
  }
}

export interface PendingUserInput {
  conversation: ConversationRef;
  sessionId: string;
  requestId: string;
  question: string;
  choices?: string[];
  allowFreeform: boolean;
  createdAt: number;
  promptHandle?: UserInputPromptHandle;
}

type PendingUserInputState = PendingUserInput & {
  transport: OutboundTransport;
  resolve: (value: UserInputResponse) => void;
  reject: (reason: Error) => void;
};

type PendingUserInputListener = (pending?: PendingUserInput) => void;

const pendingInputs = new Map<string, PendingUserInputState>();
const listeners = new Map<string, Set<PendingUserInputListener>>();

function createRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function normalizeAnswer(answer: string): string {
  return answer.trim();
}

function choiceMatches(choice: string, answer: string): boolean {
  return choice.trim().toLowerCase() === answer.trim().toLowerCase();
}

function toPublicPending(state: PendingUserInputState): PendingUserInput {
  return {
    conversation: state.conversation,
    sessionId: state.sessionId,
    requestId: state.requestId,
    question: state.question,
    choices: state.choices,
    allowFreeform: state.allowFreeform,
    createdAt: state.createdAt,
    promptHandle: state.promptHandle,
  };
}

function emit(conversationKey: string) {
  const handlers = listeners.get(conversationKey);
  if (!handlers || handlers.size === 0) return;

  const pending = getPendingUserInput(conversationKey);
  for (const handler of handlers) {
    handler(pending);
  }
}

export function getPendingUserInput(
  conversation: ConversationRef | string,
): PendingUserInput | undefined {
  const key = typeof conversation === "string" ? conversation : buildConversationKey(conversation);
  const pending = pendingInputs.get(key);
  return pending ? toPublicPending(pending) : undefined;
}

export function watchPendingUserInput(
  conversation: ConversationRef | string,
  handler: PendingUserInputListener,
): () => void {
  const key = typeof conversation === "string" ? conversation : buildConversationKey(conversation);
  const handlers = listeners.get(key) ?? new Set<PendingUserInputListener>();
  handlers.add(handler);
  listeners.set(key, handlers);

  return () => {
    const nextHandlers = listeners.get(key);
    if (!nextHandlers) return;
    nextHandlers.delete(handler);
    if (nextHandlers.size === 0) {
      listeners.delete(key);
    }
  };
}

export async function requestUserInput(params: {
  conversation: ConversationRef;
  sessionId: string;
  transport: OutboundTransport;
  request: UserInputRequest;
}): Promise<UserInputResponse> {
  const conversationKey = buildConversationKey(params.conversation);
  const pending = pendingInputs.get(conversationKey);
  if (pending) {
    return {
      answer:
        "User input is already pending in this conversation. Do not ask another question until that answer arrives.",
      wasFreeform: true,
    };
  }

  return new Promise<UserInputResponse>((resolve, reject) => {
    const state: PendingUserInputState = {
      conversation: params.conversation,
      transport: params.transport,
      sessionId: params.sessionId,
      requestId: createRequestId(),
      question: params.request.question,
      choices: params.request.choices,
      allowFreeform: params.request.allowFreeform !== false,
      createdAt: Date.now(),
      promptHandle: undefined,
      resolve: (value) => {
        pendingInputs.delete(conversationKey);
        emit(conversationKey);
        resolve(value);
      },
      reject: (reason) => {
        pendingInputs.delete(conversationKey);
        emit(conversationKey);
        reject(reason);
      },
    };

    pendingInputs.set(conversationKey, state);
    emit(conversationKey);

    void params.transport
      .requestUserInput(params.conversation, {
        requestId: state.requestId,
        question: state.question,
        choices: state.choices,
        allowFreeform: state.allowFreeform,
      })
      .then((promptHandle) => {
        const activeState = pendingInputs.get(conversationKey);
        if (activeState !== state) return;
        activeState.promptHandle = promptHandle;
        emit(conversationKey);
        getLogger().info(
          {
            conversationKey,
            platform: params.conversation.platform,
            sessionId: params.sessionId,
            promptHandle: promptHandle?.id,
          },
          "Sent ask_user prompt",
        );
      })
      .catch((error: unknown) => {
        const activeState = pendingInputs.get(conversationKey);
        if (activeState !== state) return;
        activeState.reject(
          error instanceof Error
            ? error
            : new Error(`Failed to send ask_user prompt: ${String(error)}`),
        );
      });
  });
}

export function resolvePendingUserInput(
  conversation: ConversationRef | string,
  answer: string,
): UserInputResponse | undefined {
  const key = typeof conversation === "string" ? conversation : buildConversationKey(conversation);
  const pending = pendingInputs.get(key);
  if (!pending) return undefined;

  const normalizedAnswer = normalizeAnswer(answer);
  const matchedChoice = pending.choices?.find((choice) => choiceMatches(choice, normalizedAnswer));
  if (!pending.allowFreeform && pending.choices?.length && !matchedChoice) {
    return undefined;
  }

  const response = {
    answer: matchedChoice ?? normalizedAnswer,
    wasFreeform: !matchedChoice,
  };

  pending.resolve(response);
  return response;
}

export async function cancelPendingUserInput(
  conversation: ConversationRef | string,
  reason: string,
  opts?: { notifyUser?: boolean },
): Promise<boolean> {
  const key = typeof conversation === "string" ? conversation : buildConversationKey(conversation);
  const pending = pendingInputs.get(key);
  if (!pending) return false;

  if (pending.promptHandle) {
    await pending.transport
      .clearUserInputPrompt(pending.conversation, pending.promptHandle)
      .catch((err) => {
        getLogger().warn({ err, conversationKey: key }, "Failed to clear ask_user prompt");
      });
  }

  pending.reject(new PendingUserInputCancelledError(reason));
  getLogger().info(
    { conversationKey: key, sessionId: pending.sessionId, reason },
    "Cancelled pending ask_user",
  );

  if (opts?.notifyUser) {
    await pending.transport.sendText(pending.conversation, reason).catch((err) => {
      getLogger().warn(
        { err, conversationKey: key },
        "Failed to send ask_user cancellation notice",
      );
    });
  }

  return true;
}

export async function cancelPendingUserInputForSession(
  conversation: ConversationRef | string,
  sessionId: string,
  reason: string,
  opts?: { notifyUser?: boolean },
): Promise<boolean> {
  const key = typeof conversation === "string" ? conversation : buildConversationKey(conversation);
  const pending = pendingInputs.get(key);
  if (!pending || pending.sessionId !== sessionId) return false;

  return cancelPendingUserInput(key, reason, opts);
}

export async function cancelAllPendingUserInputs(
  reason: string,
  opts?: { notifyUser?: boolean },
): Promise<void> {
  const keys = Array.from(pendingInputs.keys());
  for (const key of keys) {
    await cancelPendingUserInput(key, reason, opts);
  }
}
