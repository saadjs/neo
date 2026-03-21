import { Bot, type Context } from "grammy";
import { run, type RunnerHandle } from "@grammyjs/runner";
import type { SessionEvent, MessageOptions } from "@github/copilot-sdk";
import { config } from "./config";
import {
  beginSessionTurn,
  consumeAbortFlag,
  discardSession,
  endSessionTurn,
  getClient,
  getModelForChat,
  getOrCreateSession,
  hasTrackedSession,
} from "./agent";
import { getLogger } from "./logging/index";
import {
  logMessage,
  logToolCall,
  completeToolCall,
  getLastCompactionEventId,
  setLastCompactionEventId,
  setSessionTags,
} from "./logging/conversations";
import { registerCommands } from "./commands/index";
import { handleModelCallback, isModelCallback } from "./commands/model";
import { handleReasoningCallback, isReasoningCallback } from "./commands/reasoning";
import { handleSessionCallback, isSessionCallback } from "./commands/session";
import { handleJobsCallback, isJobsCallback } from "./commands/jobs";
import { downloadTelegramFile } from "./telegram/files";
import { splitMessage } from "./telegram/messages";
import { appendCompactionMemory } from "./memory/index";
import { recordCompactionTokens, recordMessageEstimate } from "./logging/cost";
import { extractTags } from "./memory/tagging";
import { isVoiceEnabled, transcribeFile } from "./voice/transcribe";
import { type ProgressPhase, formatProgressName, buildProgressText } from "./telegram/progress";
import {
  SESSION_HEALTH_POLL_MS,
  TYPING_REFRESH_MS,
  PROGRESS_REFRESH_MS,
  PROGRESS_EDIT_DEBOUNCE_MS,
  STREAMING_MSG_MAX_LEN,
  LOG_TRANSCRIPT_MAX_CHARS,
  LOG_REASONING_MAX_CHARS,
} from "./constants";
import {
  isMessageNotModifiedError,
  isMissingProgressMessageError,
} from "./telegram/session-timeout";
import {
  cancelPendingUserInputForSession,
  getPendingUserInput,
  handleUserInputCallback,
  isUserInputCallback,
  resolvePendingUserInput,
  watchPendingUserInput,
} from "./telegram/user-input";
import { shouldSilenceSessionError } from "./telegram/session-errors";
import { consumeSessionErrorNotified } from "./hooks/error-state";
import { resetModelCallFailures } from "./hooks/error";

async function sendAndWaitForSessionIdle(
  chatId: number,
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
        `Copilot client connection lost while waiting for session completion (chat ${chatId})`,
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

export interface BotHandle {
  api: Bot["api"];
  runner: RunnerHandle;
}

export async function createBot(): Promise<BotHandle> {
  const bot = new Bot(config.telegram.botToken);
  const log = getLogger();

  // Keep DMs owner-only, but allow group chats to flow without requiring a tag.
  bot.use(async (ctx, next) => {
    const chatType = ctx.chat?.type;
    const isGroupChat = chatType === "group" || chatType === "supergroup";
    if (!isGroupChat && ctx.from?.id !== config.telegram.ownerId) return;
    await next();
  });

  await registerCommands(bot);

  bot.on("callback_query:data", async (ctx) => {
    if (isUserInputCallback(ctx.callbackQuery.data)) {
      await handleUserInputCallback(ctx);
      return;
    }
    if (isReasoningCallback(ctx.callbackQuery.data)) {
      await handleReasoningCallback(ctx);
      return;
    }
    if (isSessionCallback(ctx.callbackQuery.data)) {
      await handleSessionCallback(ctx);
      return;
    }
    if (isJobsCallback(ctx.callbackQuery.data)) {
      await handleJobsCallback(ctx);
      return;
    }
    if (!isModelCallback(ctx.callbackQuery.data)) return;
    await handleModelCallback(ctx);
  });

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;

    const pendingInput = getPendingUserInput(ctx.chat!.id);
    if (pendingInput) {
      const response = resolvePendingUserInput(ctx.chat!.id, text);
      if (response) {
        await ctx.reply("Resuming task…");
      } else {
        await ctx.reply(
          "That answer doesn't match the allowed choices. Tap one of the buttons on the pending prompt.",
        );
      }
      return;
    }

    // Skip slash commands (handled by command handlers)
    if (text.startsWith("/")) return;

    await handleMessage(ctx, text);
  });

  // Handle photos sent to the bot
  bot.on("message:photo", async (ctx) => {
    if (await replyIfWaitingForTextAnswer(ctx)) return;

    const caption = ctx.message.caption ?? "What's in this image?";
    const photos = ctx.message.photo;
    // Telegram sends multiple sizes — pick the largest
    const largest = photos[photos.length - 1];

    try {
      const localPath = await downloadTelegramFile(ctx.api, largest.file_id);
      await handleMessage(ctx, caption, [{ type: "file", path: localPath }]);
    } catch (err) {
      log.error({ err }, "Failed to download photo");
      await ctx.reply("Failed to download the photo. Please try again.");
    }
  });

  // Handle documents/files sent to the bot
  bot.on("message:document", async (ctx) => {
    if (await replyIfWaitingForTextAnswer(ctx)) return;

    const doc = ctx.message.document;
    const caption = ctx.message.caption ?? `I sent you a file: ${doc.file_name ?? "unknown"}`;

    try {
      const localPath = await downloadTelegramFile(
        ctx.api,
        doc.file_id,
        doc.file_name ?? undefined,
      );
      await handleMessage(ctx, caption, [
        { type: "file", path: localPath, displayName: doc.file_name ?? undefined },
      ]);
    } catch (err) {
      log.error({ err }, "Failed to download document");
      await ctx.reply("Failed to download the file. Please try again.");
    }
  });

  // Handle voice messages
  bot.on("message:voice", async (ctx) => {
    if (await replyIfWaitingForTextAnswer(ctx)) return;

    if (!isVoiceEnabled()) {
      await ctx.reply("Voice messages are not configured. Set DEEPGRAM_API_KEY to enable.");
      return;
    }

    try {
      const localPath = await downloadTelegramFile(ctx.api, ctx.message.voice.file_id, "voice.ogg");
      const transcript = await transcribeFile(localPath);

      if (!transcript.trim()) {
        await ctx.reply("Couldn't make out what you said. Try again?");
        return;
      }

      log.info(
        { chatId: ctx.chat!.id, transcript: transcript.slice(0, LOG_TRANSCRIPT_MAX_CHARS) },
        "Voice transcribed",
      );
      await handleMessage(ctx, transcript);
    } catch (err) {
      log.error({ err }, "Failed to process voice message");
      await ctx.reply("Failed to process the voice message. Please try again.");
    }
  });

  bot.catch((err) => {
    log.error({ err: err.error, ctx: err.ctx?.update?.update_id }, "Bot error");
  });

  const runner = run(bot);
  log.info("Telegram bot started (concurrent runner)");

  return { api: bot.api, runner };
}

async function handleMessage(
  ctx: Context,
  text: string,
  attachments?: MessageOptions["attachments"],
) {
  const log = getLogger();
  const chatId = ctx.chat!.id;
  const startedAt = Date.now();
  let activeSession: Awaited<ReturnType<typeof getOrCreateSession>> | null = null;

  await ctx.replyWithChatAction("typing");

  let typingActive = true;
  const sendTyping = async () => {
    if (!typingActive) return;
    try {
      await ctx.replyWithChatAction("typing");
    } catch {}
  };

  let progressMessageId: number | null = null;
  let progressText = "";
  let progressPhase: ProgressPhase = "thinking";
  let progressDetail = "";
  let lastProgressEditAt = 0;
  let streamBuffer = "";
  let typingInterval: ReturnType<typeof setInterval> | null = null;
  let progressInterval: ReturnType<typeof setInterval> | null = null;

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
      if (progressMessageId == null) {
        const message = await ctx.reply(nextText);
        progressMessageId = message.message_id;
        return;
      }

      await ctx.api.editMessageText(chatId, progressMessageId, nextText);
    } catch (err) {
      if (isMessageNotModifiedError(err)) return;
      if (isMissingProgressMessageError(err)) {
        progressMessageId = null;
      }
      log.debug({ err, chatId, nextText }, "Failed to update progress message");
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

  const updateStreamingMessage = async () => {
    if (!streamBuffer || progressPhase !== "streaming") return;

    const now = Date.now();
    if (now - lastProgressEditAt < PROGRESS_EDIT_DEBOUNCE_MS) return;
    lastProgressEditAt = now;

    // Truncate to fit Telegram limit, showing the tail
    const maxLen = STREAMING_MSG_MAX_LEN;
    const display = streamBuffer.length > maxLen ? `…${streamBuffer.slice(-maxLen)}` : streamBuffer;

    try {
      if (progressMessageId == null) {
        const message = await ctx.reply(display);
        progressMessageId = message.message_id;
        return;
      }
      await ctx.api.editMessageText(chatId, progressMessageId, display);
    } catch (err) {
      if (isMessageNotModifiedError(err)) return;
      if (isMissingProgressMessageError(err)) {
        progressMessageId = null;
      }
      log.debug({ err, chatId }, "Failed to update streaming message");
    }
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

  startTypingLoop();
  startProgressLoop();

  const clearLiveStatus = async () => {
    typingActive = false;
    stopTypingLoop();
    stopProgressLoop();

    const msgId = progressMessageId;
    progressMessageId = null;

    if (msgId != null) {
      try {
        await ctx.api.deleteMessage(chatId, msgId);
      } catch {}
    }
  };

  await setProgress("thinking", "", true);

  let unsubscribe = () => {};
  let unwatchPendingInput = () => {};
  let sessionTurnStarted = false;

  try {
    let responseBuffer = "";
    let sessionId = "";
    let lastAssistantMessage: SessionEvent | undefined;
    const toolStartTimes = new Map<string, number>();
    beginSessionTurn(chatId);
    sessionTurnStarted = true;
    const session = await getOrCreateSession({ chatId });
    activeSession = session;
    sessionId = session.sessionId;

    unwatchPendingInput = watchPendingUserInput(chatId, (pending) => {
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

    const onEvent = async (event: SessionEvent) => {
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
            { chatId, reasoning: reasoning.slice(0, LOG_REASONING_MAX_CHARS) },
            "Agent reasoning",
          );
        }
        await setProgress("reasoning");
      }

      if (event.type === "tool.execution_start") {
        const d = event.data as { toolCallId?: string; toolName?: string; arguments?: unknown };
        if (d.toolCallId && d.toolName) {
          toolStartTimes.set(d.toolCallId, Date.now());
          await setProgress("tool", formatProgressName(d.toolName));
          try {
            logToolCall(sessionId, d.toolCallId, d.toolName, d.arguments);
          } catch {}
        }
      }

      if (event.type === "tool.execution_complete") {
        const d = event.data as {
          toolCallId?: string;
          toolName?: string;
          success?: boolean;
          result?: unknown;
        };
        if (d.toolCallId) {
          const startTime = toolStartTimes.get(d.toolCallId);
          const duration = startTime ? Date.now() - startTime : undefined;
          const toolName = d.toolName ? formatProgressName(d.toolName) : "tool";

          await setProgress("done-tool", toolName);

          try {
            completeToolCall(d.toolCallId, d.result, d.success ?? true, duration);
          } catch {}
        }
      }

      if (event.type === "skill.invoked") {
        const d = event.data as { name?: string; path?: string };
        log.info({ chatId, skill: d.name, path: d.path }, "Skill invoked");
        await setProgress("skill", formatProgressName(d.name));
      }

      if (event.type === "session.compaction_start") {
        log.info({ chatId, sessionId }, "Session compaction started");
        await setProgress("compacting");
      }

      if (event.type === "session.compaction_complete") {
        const data = event.data;
        if (!data.success || !data.summaryContent?.trim()) {
          log.warn({ chatId, sessionId, data }, "Session compaction finished without summary");
          return;
        }

        if (getLastCompactionEventId(chatId) === event.id) {
          return;
        }

        try {
          await appendCompactionMemory({
            timestamp: event.timestamp,
            chatId,
            sessionId,
            model: getModelForChat(chatId),
            preCompactionTokens: data.preCompactionTokens,
            postCompactionTokens: data.postCompactionTokens,
            messagesRemoved: data.messagesRemoved,
            checkpointNumber: data.checkpointNumber,
            checkpointPath: data.checkpointPath,
            summaryContent: data.summaryContent,
          });
          recordCompactionTokens({
            sessionId,
            model: getModelForChat(chatId),
            preCompactionTokens: data.preCompactionTokens,
            postCompactionTokens: data.postCompactionTokens,
          });
          setLastCompactionEventId(chatId, event.id);
          const tags = extractTags(data.summaryContent);
          setSessionTags(sessionId, tags);
          log.info({ chatId, sessionId, tags }, "Session tagged from compaction summary");
          await ctx.reply("Context summary saved to today's memory.");
        } catch (err) {
          log.error({ err, chatId, sessionId, eventId: event.id }, "Failed to persist compaction");
        }
      }
    };

    unsubscribe = session.on(onEvent);

    try {
      logMessage(sessionId, "user", text);
      recordMessageEstimate({
        sessionId,
        model: getModelForChat(chatId),
        role: "user",
        content: text,
      });
    } catch {}

    await sendAndWaitForSessionIdle(chatId, session, async () => {
      await session.send({ prompt: text, attachments });
    });
    resetModelCallFailures(sessionId);

    if (consumeAbortFlag(chatId)) {
      await clearLiveStatus();
      return;
    }

    const finalContent =
      (lastAssistantMessage?.data as { content?: string } | undefined)?.content ?? responseBuffer;

    try {
      logMessage(sessionId, "assistant", finalContent || "(no response)", lastAssistantMessage?.id);
      recordMessageEstimate({
        sessionId,
        model: getModelForChat(chatId),
        role: "assistant",
        content: finalContent || "",
      });
    } catch {}

    await clearLiveStatus();

    if (!finalContent || finalContent.trim() === "") {
      await ctx.reply("_(no response)_", { parse_mode: "Markdown" });
      return;
    }

    const chunks = splitMessage(finalContent);
    for (const chunk of chunks) {
      await sendChunk(ctx, chunk);
    }
  } catch (err) {
    await clearLiveStatus();
    const clientState = getClient()?.getState();
    const hasActiveSession = activeSession !== null;
    const isTrackedSession = activeSession ? hasTrackedSession(chatId, activeSession) : false;
    const sessionId = activeSession?.sessionId;

    if (sessionId) {
      await cancelPendingUserInputForSession(
        chatId,
        sessionId,
        "The pending question was cancelled because the session ended.",
      );
    }

    if (activeSession && clientState !== "connected") {
      discardSession(chatId, activeSession);
    }

    if (
      shouldSilenceSessionError(err, {
        hasActiveSession,
        isTrackedSession,
        clientState,
      })
    ) {
      log.info({ chatId, err }, "Session ended without user-facing error");
      return;
    }

    if (sessionId && consumeSessionErrorNotified(sessionId)) {
      log.info({ chatId, sessionId, err }, "Session error already surfaced to user");
      return;
    }

    log.error({ err, chatId }, "Error handling message");
    await ctx.reply("⚠️ Something went wrong. Try /new to start a fresh session.");
  } finally {
    unsubscribe();
    unwatchPendingInput();
    if (sessionTurnStarted) {
      await endSessionTurn(chatId);
    }
  }
}

async function sendChunk(ctx: Context, text: string) {
  try {
    await ctx.reply(text, { parse_mode: "Markdown" });
  } catch {
    // Fallback without markdown parsing
    await ctx.reply(text);
  }
}

async function replyIfWaitingForTextAnswer(ctx: Context): Promise<boolean> {
  if (!getPendingUserInput(ctx.chat!.id)) return false;

  await ctx.reply("I’m waiting for a text answer to the pending question before I can continue.");
  return true;
}
