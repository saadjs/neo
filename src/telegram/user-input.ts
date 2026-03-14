import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getLogger } from "../logging/index.js";
import { getTelegramApi } from "./runtime.js";

interface UserInputRequest {
  question: string;
  choices?: string[];
  allowFreeform?: boolean;
}

interface UserInputResponse {
  answer: string;
  wasFreeform: boolean;
}

export class PendingUserInputCancelledError extends Error {
  constructor(message = "User input request cancelled.") {
    super(message);
    this.name = "PendingUserInputCancelledError";
  }
}

export interface PendingUserInput {
  chatId: number;
  sessionId: string;
  requestId: string;
  question: string;
  choices?: string[];
  allowFreeform: boolean;
  createdAt: number;
  promptMessageId?: number;
}

type PendingUserInputState = PendingUserInput & {
  resolve: (value: UserInputResponse) => void;
  reject: (reason: Error) => void;
};

type PendingUserInputListener = (pending?: PendingUserInput) => void;

const pendingInputs = new Map<number, PendingUserInputState>();
const listeners = new Map<number, Set<PendingUserInputListener>>();

function toPublicPending(state: PendingUserInputState): PendingUserInput {
  return {
    chatId: state.chatId,
    sessionId: state.sessionId,
    requestId: state.requestId,
    question: state.question,
    choices: state.choices,
    allowFreeform: state.allowFreeform,
    createdAt: state.createdAt,
    promptMessageId: state.promptMessageId,
  };
}

function emit(chatId: number) {
  const handlers = listeners.get(chatId);
  if (!handlers || handlers.size === 0) return;

  const pending = getPendingUserInput(chatId);
  for (const handler of handlers) {
    handler(pending);
  }
}

function buildQuestionMessage(request: UserInputRequest): string {
  const lines = ["Need your input to continue:", "", request.question.trim()];

  if (request.choices?.length && request.allowFreeform === false) {
    lines.push("", "Choose one below.");
  } else if (request.choices?.length) {
    lines.push("", "Choose one below or reply with your own answer.");
  } else {
    lines.push("", "Reply with your answer in your next text message.");
  }

  return lines.join("\n");
}

function createRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function buildChoicesMarkup(requestId: string, choices: string[]) {
  return InlineKeyboard.from(
    choices.map((choice, index) => [InlineKeyboard.text(choice, `ask:${requestId}:${index}`)]),
  );
}

function parseUserInputCallbackData(
  data: string,
): { requestId: string; choiceIndex: number } | null {
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== "ask") return null;

  const choiceIndex = Number(parts[2]);
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0) return null;

  return { requestId: parts[1], choiceIndex };
}

function normalizeAnswer(answer: string): string {
  return answer.trim();
}

function choiceMatches(choice: string, answer: string): boolean {
  return choice.trim().toLowerCase() === answer.trim().toLowerCase();
}

export function getPendingUserInput(chatId: number): PendingUserInput | undefined {
  const pending = pendingInputs.get(chatId);
  return pending ? toPublicPending(pending) : undefined;
}

export function watchPendingUserInput(
  chatId: number,
  handler: PendingUserInputListener,
): () => void {
  const handlers = listeners.get(chatId) ?? new Set<PendingUserInputListener>();
  handlers.add(handler);
  listeners.set(chatId, handlers);

  return () => {
    const nextHandlers = listeners.get(chatId);
    if (!nextHandlers) return;
    nextHandlers.delete(handler);
    if (nextHandlers.size === 0) {
      listeners.delete(chatId);
    }
  };
}

export async function requestUserInput(
  chatId: number,
  sessionId: string,
  request: UserInputRequest,
): Promise<UserInputResponse> {
  const pending = pendingInputs.get(chatId);
  if (pending) {
    return {
      answer:
        "User input is already pending in this chat. Do not ask another question until that answer arrives.",
      wasFreeform: true,
    };
  }

  const api = getTelegramApi();
  if (!api) {
    throw new Error("Telegram API not initialized for ask_user.");
  }

  return new Promise<UserInputResponse>((resolve, reject) => {
    const state: PendingUserInputState = {
      chatId,
      sessionId,
      requestId: createRequestId(),
      question: request.question,
      choices: request.choices,
      allowFreeform: request.allowFreeform !== false,
      createdAt: Date.now(),
      promptMessageId: undefined,
      resolve: (value) => {
        pendingInputs.delete(chatId);
        emit(chatId);
        resolve(value);
      },
      reject: (reason) => {
        pendingInputs.delete(chatId);
        emit(chatId);
        reject(reason);
      },
    };

    pendingInputs.set(chatId, state);
    emit(chatId);

    const sendOptions = request.choices?.length
      ? { reply_markup: buildChoicesMarkup(state.requestId, request.choices) }
      : undefined;

    void api
      .sendMessage(chatId, buildQuestionMessage(request), sendOptions)
      .then((message) => {
        const activeState = pendingInputs.get(chatId);
        if (activeState !== state) return;

        activeState.promptMessageId = message.message_id;
        emit(chatId);
        getLogger().info(
          { chatId, sessionId, messageId: message.message_id },
          "Sent ask_user prompt",
        );
      })
      .catch((error: unknown) => {
        const activeState = pendingInputs.get(chatId);
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
  chatId: number,
  answer: string,
): UserInputResponse | undefined {
  const pending = pendingInputs.get(chatId);
  if (!pending) return undefined;

  const normalizedAnswer = normalizeAnswer(answer);
  const matchedChoice = pending.choices?.find((choice) => choiceMatches(choice, normalizedAnswer));
  if (!pending.allowFreeform && pending.choices?.length && !matchedChoice) {
    return undefined;
  }

  const wasFreeform = !matchedChoice;

  pending.resolve({
    answer: matchedChoice ?? normalizedAnswer,
    wasFreeform,
  });

  return {
    answer: matchedChoice ?? normalizedAnswer,
    wasFreeform,
  };
}

export function isUserInputCallback(data: string | undefined): boolean {
  return typeof data === "string" && data.startsWith("ask:");
}

async function clearPromptReplyMarkup(chatId: number, messageId: number): Promise<void> {
  const api = getTelegramApi();
  if (!api) return;

  try {
    await api.editMessageReplyMarkup(chatId, messageId, {
      reply_markup: new InlineKeyboard(),
    });
  } catch (err) {
    getLogger().warn({ err, chatId, messageId }, "Failed to clear ask_user prompt markup");
  }
}

async function safeAnswerCallbackQuery(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery({ text });
  } catch (err) {
    getLogger().warn({ err, chatId: ctx.chat?.id }, "Failed to answer ask_user callback query");
  }
}

export async function handleUserInputCallback(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;
  const data = callbackQuery?.data;
  const parsed = data ? parseUserInputCallbackData(data) : null;

  if (!callbackQuery || !parsed) {
    return false;
  }

  const pending = ctx.chat ? pendingInputs.get(ctx.chat.id) : undefined;
  const message = callbackQuery.message;

  if (!pending || !message || !("message_id" in message) || !ctx.chat) {
    if (ctx.chat && message && "message_id" in message) {
      await clearPromptReplyMarkup(ctx.chat.id, message.message_id);
    }
    await safeAnswerCallbackQuery(ctx, "This prompt is no longer active.");
    return true;
  }

  if (
    pending.requestId !== parsed.requestId ||
    (pending.promptMessageId !== undefined && pending.promptMessageId !== message.message_id)
  ) {
    await clearPromptReplyMarkup(ctx.chat.id, message.message_id);
    await safeAnswerCallbackQuery(ctx, "This prompt expired. Please use the latest one.");
    return true;
  }

  const choice = pending.choices?.[parsed.choiceIndex];
  if (!choice) {
    await clearPromptReplyMarkup(ctx.chat.id, message.message_id);
    await safeAnswerCallbackQuery(ctx, "That option is no longer available.");
    return true;
  }

  getLogger().info({ chatId: ctx.chat.id, choice }, "ask_user choice selected");

  pending.resolve({
    answer: choice,
    wasFreeform: false,
  });

  await clearPromptReplyMarkup(ctx.chat.id, message.message_id);
  await safeAnswerCallbackQuery(ctx, `Selected: ${choice}`);
  return true;
}

export async function cancelPendingUserInput(
  chatId: number,
  reason: string,
  opts?: { notifyUser?: boolean },
): Promise<boolean> {
  const pending = pendingInputs.get(chatId);
  if (!pending) return false;

  if (pending.promptMessageId) {
    await clearPromptReplyMarkup(chatId, pending.promptMessageId);
  }

  pending.reject(new PendingUserInputCancelledError(reason));
  getLogger().info({ chatId, sessionId: pending.sessionId, reason }, "Cancelled pending ask_user");

  if (opts?.notifyUser) {
    const api = getTelegramApi();
    if (api) {
      try {
        await api.sendMessage(chatId, reason);
      } catch (err) {
        getLogger().warn({ err, chatId }, "Failed to send ask_user cancellation notice");
      }
    }
  }

  return true;
}

export async function cancelPendingUserInputForSession(
  chatId: number,
  sessionId: string,
  reason: string,
  opts?: { notifyUser?: boolean },
): Promise<boolean> {
  const pending = pendingInputs.get(chatId);
  if (!pending || pending.sessionId !== sessionId) return false;

  return cancelPendingUserInput(chatId, reason, opts);
}

export async function cancelAllPendingUserInputs(
  reason: string,
  opts?: { notifyUser?: boolean },
): Promise<void> {
  const chatIds = Array.from(pendingInputs.keys());
  for (const chatId of chatIds) {
    await cancelPendingUserInput(chatId, reason, opts);
  }
}
