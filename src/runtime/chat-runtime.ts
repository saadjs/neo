import type { MessageOptions, SessionEvent } from "@github/copilot-sdk";
import {
  beginSessionTurn,
  consumeAbortFlag,
  discardSession,
  endSessionTurn,
  getClient,
  getModelForChat,
  getOrCreateSession,
  hasTrackedSession,
} from "../agent";
import {
  logMessage,
  logToolCall,
  completeToolCall,
  getLastCompactionEventId,
  setLastCompactionEventId,
  setSessionTags,
} from "../logging/conversations";
import { getLogger } from "../logging/index";
import { appendCompactionMemory } from "../memory/index";
import { extractTags } from "../memory/tagging";
import { recordCompactionTokens, recordMessageEstimate } from "../logging/cost";
import { shouldSilenceSessionError } from "./session-errors";
import { consumeSessionErrorNotified } from "../hooks/error-state";
import {
  SESSION_HEALTH_POLL_MS,
  TYPING_REFRESH_MS,
  PROGRESS_REFRESH_MS,
  PROGRESS_EDIT_DEBOUNCE_MS,
  STREAMING_MSG_MAX_LEN,
  LOG_REASONING_MAX_CHARS,
} from "../constants";
import { buildProgressText, formatProgressName, type ProgressPhase } from "./progress";
import { splitMessage } from "./messages";
import { cancelPendingUserInputForSession, watchPendingUserInput } from "../transport/user-input";
import type {
  AttachmentRef,
  ConversationRef,
  OutboundTransport,
  TransportMessageHandle,
} from "../transport/types";
import { buildConversationKey } from "../transport/types";

interface RuntimeInboundMessage {
  conversation: ConversationRef;
  text: string;
  attachments?: AttachmentRef[];
}

function toMessageAttachments(
  attachments?: AttachmentRef[],
): MessageOptions["attachments"] | undefined {
  if (!attachments?.length) return undefined;
  return attachments.map((attachment) => ({
    type: "file",
    path: attachment.path,
    displayName: attachment.fileName,
  }));
}

async function sendAndWaitForSessionIdle(
  scopeId: string,
  session: { on(handler: (event: SessionEvent) => void): () => void },
  send: () => Promise<unknown>,
): Promise<void> {
  let resolveWhenIdle: (() => void) | null = null;
  let rejectWhenIdle: ((error: Error) => void) | null = null;
  let settled = false;

  const settle = (handler: (() => void) | ((error: Error) => void) | null, value?: Error) => {
    if (settled || !handler) return;
    settled = true;
    if (value) {
      (handler as (error: Error) => void)(value);
      return;
    }
    (handler as () => void)();
  };

  const idlePromise = new Promise<void>((resolve, reject) => {
    resolveWhenIdle = resolve;
    rejectWhenIdle = reject;
  });

  const unsubscribe = session.on((event) => {
    if (event.type === "session.idle") {
      settle(resolveWhenIdle);
      return;
    }

    if (event.type === "session.error") {
      const data = event.data as { message?: string; stack?: string };
      const error = new Error(data.message || "Session error");
      error.stack = data.stack;
      settle(rejectWhenIdle, error);
    }
  });

  const connectionPromise = new Promise<void>((_, reject) => {
    const interval = setInterval(() => {
      const state = getClient()?.getState();
      if (state === "connected") return;

      clearInterval(interval);
      const error = new Error(
        `Copilot client connection lost while waiting for session completion (scope ${scopeId})`,
      );
      settle(rejectWhenIdle, error);
      reject(error);
    }, SESSION_HEALTH_POLL_MS);

    void idlePromise.finally(() => {
      clearInterval(interval);
    });
  });

  try {
    await send();
    await Promise.race([idlePromise, connectionPromise]);
  } finally {
    unsubscribe();
  }
}

async function sendTextChunk(
  transport: OutboundTransport,
  conversation: ConversationRef,
  text: string,
): Promise<void> {
  await transport.sendText(conversation, text, { format: "markdown" });
}

export async function handleRuntimeMessage(
  transport: OutboundTransport,
  input: RuntimeInboundMessage,
): Promise<void> {
  const log = getLogger();
  const conversationKey = buildConversationKey(input.conversation);
  const scopeId = input.conversation.id;
  const startedAt = Date.now();
  const attachments = toMessageAttachments(input.attachments);
  let activeSession: Awaited<ReturnType<typeof getOrCreateSession>> | null = null;

  await transport.indicateTyping(input.conversation);

  let typingActive = true;
  let progressMessage: TransportMessageHandle | null = null;
  let progressText = "";
  let progressPhase: ProgressPhase = "thinking";
  let progressDetail = "";
  let lastProgressEditAt = 0;
  let streamBuffer = "";
  let typingInterval: ReturnType<typeof setInterval> | null = null;
  let progressInterval: ReturnType<typeof setInterval> | null = null;

  const sendTyping = async () => {
    if (!typingActive) return;
    try {
      await transport.indicateTyping(input.conversation);
    } catch {
      // ignore indicator failures
    }
  };

  const setProgress = async (phase: ProgressPhase, detail = "", force = false) => {
    progressPhase = phase;
    progressDetail = detail;

    const nextText = buildProgressText(phase, detail, startedAt);
    const now = Date.now();

    if (!force) {
      if (nextText === progressText) return;
      if (now - lastProgressEditAt < PROGRESS_EDIT_DEBOUNCE_MS) return;
    }

    lastProgressEditAt = now;
    progressText = nextText;

    try {
      if (!progressMessage) {
        progressMessage = await transport.sendText(input.conversation, nextText);
        return;
      }

      await transport.editText(input.conversation, progressMessage, nextText);
    } catch (err) {
      if (transport.isEditNoOp?.(err)) return;
      if (transport.isEditTargetGone?.(err)) {
        progressMessage = null;
      }
      log.debug({ err, conversationKey, nextText }, "Failed to update progress message");
    }
  };

  const updateStreamingMessage = async () => {
    if (!streamBuffer || progressPhase !== "streaming") return;

    const now = Date.now();
    if (now - lastProgressEditAt < PROGRESS_EDIT_DEBOUNCE_MS) return;
    lastProgressEditAt = now;

    const display =
      streamBuffer.length > STREAMING_MSG_MAX_LEN
        ? `…${streamBuffer.slice(-STREAMING_MSG_MAX_LEN)}`
        : streamBuffer;

    try {
      if (!progressMessage) {
        progressMessage = await transport.sendText(input.conversation, display);
        return;
      }
      await transport.editText(input.conversation, progressMessage, display);
    } catch (err) {
      if (transport.isEditNoOp?.(err)) return;
      if (transport.isEditTargetGone?.(err)) {
        progressMessage = null;
      }
      log.debug({ err, conversationKey }, "Failed to update streaming message");
    }
  };

  const startTypingLoop = () => {
    if (typingInterval) return;
    typingInterval = setInterval(() => {
      void sendTyping();
    }, TYPING_REFRESH_MS);
  };

  const stopTypingLoop = () => {
    if (!typingInterval) return;
    clearInterval(typingInterval);
    typingInterval = null;
  };

  const startProgressLoop = () => {
    if (progressInterval) return;
    progressInterval = setInterval(() => {
      if (progressPhase === "streaming") {
        void updateStreamingMessage();
      } else {
        void setProgress(progressPhase, progressDetail, true);
      }
    }, PROGRESS_REFRESH_MS);
  };

  const stopProgressLoop = () => {
    if (!progressInterval) return;
    clearInterval(progressInterval);
    progressInterval = null;
  };

  const clearLiveStatus = async () => {
    typingActive = false;
    stopTypingLoop();
    stopProgressLoop();

    const liveMessage = progressMessage;
    progressMessage = null;
    if (liveMessage) {
      try {
        await transport.deleteMessage(input.conversation, liveMessage);
      } catch {
        // ignore cleanup errors
      }
    }
  };

  startTypingLoop();
  startProgressLoop();
  await setProgress("thinking", "", true);

  let unsubscribe = () => {};
  let unwatchPendingInput = () => {};
  let sessionTurnStarted = false;

  try {
    let responseBuffer = "";
    let sessionId = "";
    let lastAssistantMessage: SessionEvent | undefined;
    const toolStartTimes = new Map<string, number>();

    beginSessionTurn(scopeId);
    sessionTurnStarted = true;
    const session = await getOrCreateSession({ chatId: scopeId });
    activeSession = session;
    sessionId = session.sessionId;

    unwatchPendingInput = watchPendingUserInput(input.conversation, (pending) => {
      if (pending?.sessionId === sessionId) {
        typingActive = false;
        stopTypingLoop();
        stopProgressLoop();
        void setProgress("waiting", "", true);
        return;
      }

      if (progressPhase !== "waiting") return;

      typingActive = true;
      startTypingLoop();
      startProgressLoop();
      void setProgress("thinking", "", true);
    });

    unsubscribe = session.on(async (event) => {
      if (event.type === "assistant.message_delta") {
        const delta = (event.data as { deltaContent?: string }).deltaContent;
        if (delta) {
          streamBuffer += delta;
          progressPhase = "streaming";
          progressDetail = "";
          void updateStreamingMessage();
        }
      }

      if (event.type === "assistant.message") {
        lastAssistantMessage = event;
        const content = (event.data as { content?: string }).content;
        if (content) responseBuffer = content;
      }

      if (event.type === "assistant.reasoning") {
        const reasoning = (event.data as { content?: string }).content;
        if (reasoning) {
          log.debug(
            { conversationKey, reasoning: reasoning.slice(0, LOG_REASONING_MAX_CHARS) },
            "Agent reasoning",
          );
        }
        await setProgress("reasoning");
      }

      if (event.type === "tool.execution_start") {
        const data = event.data as { toolCallId?: string; toolName?: string; arguments?: unknown };
        if (data.toolCallId && data.toolName) {
          toolStartTimes.set(data.toolCallId, Date.now());
          await setProgress("tool", formatProgressName(data.toolName));
          try {
            logToolCall(sessionId, data.toolCallId, data.toolName, data.arguments);
          } catch {
            // ignore logging failures
          }
        }
      }

      if (event.type === "tool.execution_complete") {
        const data = event.data as {
          toolCallId?: string;
          toolName?: string;
          success?: boolean;
          result?: unknown;
        };
        if (data.toolCallId) {
          const startTime = toolStartTimes.get(data.toolCallId);
          const duration = startTime ? Date.now() - startTime : undefined;
          const toolName = data.toolName ? formatProgressName(data.toolName) : "tool";
          await setProgress("done-tool", toolName);
          try {
            completeToolCall(data.toolCallId, data.result, data.success ?? true, duration);
          } catch {
            // ignore logging failures
          }
        }
      }

      if (event.type === "skill.invoked") {
        const data = event.data as { name?: string; path?: string };
        log.info({ conversationKey, skill: data.name, path: data.path }, "Skill invoked");
        await setProgress("skill", formatProgressName(data.name));
      }

      if (event.type === "session.compaction_start") {
        log.info({ conversationKey, sessionId }, "Session compaction started");
        await setProgress("compacting");
      }

      if (event.type === "session.compaction_complete") {
        const data = event.data;
        if (!data.success || !data.summaryContent?.trim()) {
          log.warn(
            { conversationKey, sessionId, data },
            "Session compaction finished without summary",
          );
          return;
        }

        if (getLastCompactionEventId(scopeId) === event.id) {
          return;
        }

        try {
          await appendCompactionMemory({
            timestamp: event.timestamp,
            chatId: scopeId,
            sessionId,
            model: getModelForChat(scopeId),
            preCompactionTokens: data.preCompactionTokens,
            postCompactionTokens: data.postCompactionTokens,
            messagesRemoved: data.messagesRemoved,
            checkpointNumber: data.checkpointNumber,
            checkpointPath: data.checkpointPath,
            summaryContent: data.summaryContent,
          });
          recordCompactionTokens({
            sessionId,
            model: getModelForChat(scopeId),
            preCompactionTokens: data.preCompactionTokens,
            postCompactionTokens: data.postCompactionTokens,
          });
          setLastCompactionEventId(scopeId, event.id);
          const tags = extractTags(data.summaryContent);
          setSessionTags(sessionId, tags);
          log.info({ conversationKey, sessionId, tags }, "Session tagged from compaction summary");
          await transport.sendText(input.conversation, "Context summary saved to today's memory.");
        } catch (err) {
          log.error(
            { err, conversationKey, sessionId, eventId: event.id },
            "Failed to persist compaction",
          );
        }
      }
    });

    try {
      logMessage(sessionId, "user", input.text);
      recordMessageEstimate({
        sessionId,
        model: getModelForChat(scopeId),
        role: "user",
        content: input.text,
      });
    } catch {
      // ignore logging failures
    }

    await sendAndWaitForSessionIdle(scopeId, session, async () => {
      await session.send({ prompt: input.text, attachments });
    });

    if (consumeAbortFlag(scopeId)) {
      await clearLiveStatus();
      return;
    }

    const finalContent =
      (lastAssistantMessage?.data as { content?: string } | undefined)?.content ?? responseBuffer;

    try {
      logMessage(sessionId, "assistant", finalContent || "(no response)", lastAssistantMessage?.id);
      recordMessageEstimate({
        sessionId,
        model: getModelForChat(scopeId),
        role: "assistant",
        content: finalContent || "",
      });
    } catch {
      // ignore logging failures
    }

    await clearLiveStatus();

    if (!finalContent || finalContent.trim() === "") {
      await transport.sendText(input.conversation, "_(no response)_", { format: "markdown" });
      return;
    }

    const chunks = splitMessage(finalContent, transport.capabilities.maxMessageLength);
    for (const chunk of chunks) {
      await sendTextChunk(transport, input.conversation, chunk);
    }
  } catch (err) {
    await clearLiveStatus();
    const clientState = getClient()?.getState();
    const hasActiveSession = activeSession !== null;
    const isTrackedSession = activeSession ? hasTrackedSession(scopeId, activeSession) : false;
    const sessionId = activeSession?.sessionId;

    if (sessionId) {
      await cancelPendingUserInputForSession(
        input.conversation,
        sessionId,
        "The pending question was cancelled because the session ended.",
      );
    }

    if (activeSession && clientState !== "connected") {
      discardSession(scopeId, activeSession);
    }

    if (
      shouldSilenceSessionError(err, {
        hasActiveSession,
        isTrackedSession,
        clientState,
      })
    ) {
      log.info({ conversationKey, err }, "Session ended without user-facing error");
      return;
    }

    if (sessionId && consumeSessionErrorNotified(sessionId)) {
      log.info({ conversationKey, sessionId, err }, "Session error already surfaced to user");
      return;
    }

    log.error({ err, conversationKey }, "Error handling message");
    await transport.sendText(
      input.conversation,
      "⚠️ Something went wrong. Try /new to start a fresh session.",
    );
  } finally {
    unsubscribe();
    unwatchPendingInput();
    if (sessionTurnStarted) {
      await endSessionTurn(scopeId);
    }
  }
}
