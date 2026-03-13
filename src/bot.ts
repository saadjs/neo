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
} from "./logging/conversations.js";
import { registerCommands } from "./commands/index.js";
import { downloadTelegramFile } from "./telegram/files.js";
import { appendCompactionMemory } from "./memory/index.js";

const TELEGRAM_MSG_LIMIT = 4096;
const TYPING_REFRESH_MS = 4000;
const DRAFT_THROTTLE_MS = 1500;

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
  const draftId = ctx.update.update_id;

  // Send typing indicator
  await ctx.replyWithChatAction("typing");

  let typingActive = true;
  const sendTyping = async () => {
    if (!typingActive) return;
    try {
      await ctx.replyWithChatAction("typing");
    } catch {
      // ignore
    }
  };

  // Keep typing indicator alive during processing.
  const typingInterval = setInterval(() => {
    void sendTyping();
  }, TYPING_REFRESH_MS);
  let unsubscribe = () => {};

  try {
    let responseBuffer = "";
    let lastDraftTime = 0;
    let lastDraftText = "";
    let draftActive = false;
    let sessionId = "";
    const toolStartTimes = new Map<string, number>();

    const session = await getOrCreateSession({ chatId });
    sessionId = session.sessionId;

    const onEvent = async (event: SessionEvent) => {
      if (event.type === "assistant.message") {
        const content = (event.data as { content?: string }).content;
        if (content) {
          responseBuffer = content;
        }
      }

      if (event.type === "assistant.reasoning") {
        const reasoning = (event.data as { content?: string }).content;
        if (reasoning && !draftActive) {
          log.debug({ chatId, reasoning: reasoning.slice(0, 100) }, "Agent reasoning");
        }
      }

      // Log tool executions
      if (event.type === "tool.execution_start") {
        const d = event.data as { toolCallId?: string; toolName?: string; arguments?: unknown };
        if (d.toolCallId && d.toolName) {
          toolStartTimes.set(d.toolCallId, Date.now());
          try {
            logToolCall(sessionId, d.toolCallId, d.toolName, d.arguments);
          } catch {}
        }
      }

      if (event.type === "tool.execution_complete") {
        const d = event.data as { toolCallId?: string; success?: boolean; result?: unknown };
        if (d.toolCallId) {
          const startTime = toolStartTimes.get(d.toolCallId);
          const duration = startTime ? Date.now() - startTime : undefined;
          try {
            completeToolCall(d.toolCallId, d.result, d.success ?? true, duration);
          } catch {}
        }
      }

      if (event.type === "session.compaction_start") {
        log.info({ chatId, sessionId }, "Session compaction started");
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
          await ctx.reply("Context summary saved to today's memory.");
        } catch (err) {
          log.error({ err, chatId, sessionId, eventId: event.id }, "Failed to persist compaction");
        }
      }

      // Stream intermediate updates through Telegram drafts.
      if (event.type === "assistant.message" && responseBuffer.length > 0) {
        const now = Date.now();
        if (now - lastDraftTime < DRAFT_THROTTLE_MS) return;

        const displayText = truncateForTelegram(responseBuffer);
        if (!displayText.trim() || displayText === lastDraftText) return;

        lastDraftTime = now;
        try {
          await ctx.api.sendMessageDraft(chatId, draftId, displayText);
          draftActive = true;
          typingActive = false;
          lastDraftText = displayText;
        } catch (err) {
          log.debug({ err, chatId, draftId }, "Failed to send Telegram draft update");
        }
      }
    };

    unsubscribe = session.on(onEvent);

    // Log user message
    try {
      logMessage(sessionId, "user", text);
    } catch {}

    const result = await session.sendAndWait({ prompt: text, attachments });

    typingActive = false;
    clearInterval(typingInterval);

    // Send final response
    const finalContent = (result?.data as { content?: string })?.content ?? responseBuffer;

    // Log assistant response
    try {
      logMessage(sessionId, "assistant", finalContent || "(no response)", result?.id);
    } catch {}

    if (!finalContent || finalContent.trim() === "") {
      await ctx.reply("_(no response)_", { parse_mode: "Markdown" });
      return;
    }

    // Split long messages
    const chunks = splitMessage(finalContent);

    for (const chunk of chunks) {
      await sendChunk(ctx, chunk);
    }
  } catch (err) {
    typingActive = false;
    clearInterval(typingInterval);
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

function truncateForTelegram(text: string): string {
  if (text.length <= TELEGRAM_MSG_LIMIT) return text;
  return text.slice(0, TELEGRAM_MSG_LIMIT - 3) + "...";
}

function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MSG_LIMIT) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MSG_LIMIT) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline near the limit
    let splitIdx = remaining.lastIndexOf("\n", TELEGRAM_MSG_LIMIT);
    if (splitIdx < TELEGRAM_MSG_LIMIT * 0.5) {
      // No good newline break — split at space
      splitIdx = remaining.lastIndexOf(" ", TELEGRAM_MSG_LIMIT);
    }
    if (splitIdx < TELEGRAM_MSG_LIMIT * 0.5) {
      // No good break at all — hard split
      splitIdx = TELEGRAM_MSG_LIMIT;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}
