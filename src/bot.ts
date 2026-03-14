import { Bot, Context } from "grammy";
import type { SessionEvent, MessageOptions } from "@github/copilot-sdk";
import { config } from "./config.js";
import { getModelForChat, getOrCreateSession } from "./agent.js";
import { getLogger } from "./logging/index.js";
import {
  logMessage,
  logToolCall,
  completeToolCall,
  getLastCompactionEventId,
  setLastCompactionEventId,
  setSessionTags,
} from "./logging/conversations.js";
import { registerCommands } from "./commands/index.js";
import { downloadTelegramFile } from "./telegram/files.js";
import { splitMessage } from "./telegram/messages.js";
import { appendCompactionMemory } from "./memory/index.js";
import { extractTags } from "./memory/tagging.js";
import { isVoiceEnabled, transcribeFile } from "./voice/transcribe.js";
import {
  TYPING_REFRESH_MS,
  PROGRESS_REFRESH_MS,
  PROGRESS_EDIT_DEBOUNCE_MS,
  formatProgressName,
  buildProgressText,
} from "./telegram/progress.js";

export function createBot(): Bot {
  const bot = new Bot(config.telegram.botToken);
  const log = getLogger();

  // Owner-only middleware — silently ignore everyone else
  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== config.telegram.ownerId) return;
    await next();
  });

  registerCommands(bot);

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;

    // Skip slash commands (handled by command handlers)
    if (text.startsWith("/")) return;

    await handleMessage(ctx, text);
  });

  // Handle photos sent to the bot
  bot.on("message:photo", async (ctx) => {
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

      log.info({ chatId: ctx.chat!.id, transcript: transcript.slice(0, 100) }, "Voice transcribed");
      await handleMessage(ctx, transcript);
    } catch (err) {
      log.error({ err }, "Failed to process voice message");
      await ctx.reply("Failed to process the voice message. Please try again.");
    }
  });

  bot.catch((err) => {
    log.error({ err: err.error, ctx: err.ctx?.update?.update_id }, "Bot error");
  });

  return bot;
}

async function handleMessage(
  ctx: Context,
  text: string,
  attachments?: MessageOptions["attachments"],
) {
  const log = getLogger();
  const chatId = ctx.chat!.id;
  const startedAt = Date.now();

  await ctx.replyWithChatAction("typing");

  let typingActive = true;
  const sendTyping = async () => {
    if (!typingActive) return;
    try {
      await ctx.replyWithChatAction("typing");
    } catch {}
  };

  const typingInterval = setInterval(() => {
    void sendTyping();
  }, TYPING_REFRESH_MS);

  let progressMessageId: number | null = null;
  let progressText = "";
  let progressPhase: "thinking" | "reasoning" | "tool" | "done-tool" | "skill" | "compacting" =
    "thinking";
  let progressDetail = "";
  let lastProgressEditAt = 0;

  const setProgress = async (
    phase: "thinking" | "reasoning" | "tool" | "done-tool" | "skill" | "compacting",
    detail = "",
    force = false,
  ) => {
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
      log.debug({ err, chatId, nextText }, "Failed to update progress message");
    }
  };

  const progressInterval = setInterval(() => {
    void setProgress(progressPhase, progressDetail, true);
  }, PROGRESS_REFRESH_MS);

  const clearLiveStatus = async () => {
    typingActive = false;
    clearInterval(typingInterval);
    clearInterval(progressInterval);

    if (progressMessageId != null) {
      try {
        await ctx.api.deleteMessage(chatId, progressMessageId);
      } catch {}
    }
  };

  await setProgress("thinking", "", true);

  let unsubscribe = () => {};

  try {
    let responseBuffer = "";
    let sessionId = "";
    const toolStartTimes = new Map<string, number>();

    const session = await getOrCreateSession({ chatId });
    sessionId = session.sessionId;

    const onEvent = async (event: SessionEvent) => {
      if (event.type === "assistant.message") {
        const content = (event.data as { content?: string }).content;
        if (content) responseBuffer = content;
      }

      if (event.type === "assistant.reasoning") {
        const reasoning = (event.data as { content?: string }).content;
        if (reasoning) {
          log.debug({ chatId, reasoning: reasoning.slice(0, 100) }, "Agent reasoning");
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
    } catch {}

    const result = await session.sendAndWait({ prompt: text, attachments });
    const finalContent = (result?.data as { content?: string })?.content ?? responseBuffer;

    try {
      logMessage(sessionId, "assistant", finalContent || "(no response)", result?.id);
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
    log.error({ err, chatId }, "Error handling message");
    await ctx.reply("⚠️ Something went wrong. Try /new to start a fresh session.");
  } finally {
    unsubscribe();
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
