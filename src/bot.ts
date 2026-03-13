import { Bot, Context } from "grammy";
import type { SessionEvent } from "@github/copilot-sdk";
import { config } from "./config.js";
import { getOrCreateSession } from "./agent.js";
import { getLogger } from "./logging/index.js";
import { registerCommands } from "./commands/index.js";

const TELEGRAM_MSG_LIMIT = 4096;

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

  // Handle documents/files sent to the bot
  bot.on("message:document", async (ctx) => {
    const caption = ctx.message.caption ?? "I sent you a file.";
    await handleMessage(ctx, caption);
  });

  bot.catch((err) => {
    log.error({ err: err.error, ctx: err.ctx?.update?.update_id }, "Bot error");
  });

  return bot;
}

async function handleMessage(ctx: Context, text: string) {
  const log = getLogger();
  const chatId = ctx.chat!.id;

  // Send typing indicator
  await ctx.replyWithChatAction("typing");

  // Keep typing indicator alive during processing
  const typingInterval = setInterval(async () => {
    try {
      await ctx.replyWithChatAction("typing");
    } catch {
      // ignore
    }
  }, 4000);

  try {
    let responseBuffer = "";
    let sentMessageId: number | null = null;
    let lastEditTime = 0;
    const EDIT_THROTTLE_MS = 1500;

    const onEvent = async (event: SessionEvent) => {
      if (event.type === "assistant.message") {
        const content = (event.data as { content?: string }).content;
        if (content) {
          responseBuffer = content;
        }
      }

      if (event.type === "assistant.reasoning") {
        const reasoning = (event.data as { content?: string }).content;
        if (reasoning && !sentMessageId) {
          log.debug({ chatId, reasoning: reasoning.slice(0, 100) }, "Agent reasoning");
        }
      }

      // Stream intermediate updates for long responses
      if (event.type === "assistant.message" && responseBuffer.length > 0) {
        const now = Date.now();
        if (now - lastEditTime > EDIT_THROTTLE_MS && sentMessageId) {
          lastEditTime = now;
          try {
            const displayText = truncateForTelegram(responseBuffer);
            await ctx.api
              .editMessageText(chatId, sentMessageId, displayText, {
                parse_mode: "Markdown",
              })
              .catch(() =>
                // Fallback without markdown if it fails
                ctx.api.editMessageText(chatId, sentMessageId!, displayText),
              );
          } catch {
            // edit might fail if content hasn't changed
          }
        }
      }
    };

    const session = await getOrCreateSession({ chatId, onEvent });
    const result = await session.sendAndWait({ prompt: text });

    clearInterval(typingInterval);

    // Send final response
    const finalContent = (result?.data as { content?: string })?.content ?? responseBuffer;

    if (!finalContent || finalContent.trim() === "") {
      await ctx.reply("_(no response)_", { parse_mode: "Markdown" });
      return;
    }

    // Split long messages
    const chunks = splitMessage(finalContent);

    if (sentMessageId && chunks.length === 1) {
      // Edit the existing message with final content
      try {
        await ctx.api
          .editMessageText(chatId, sentMessageId, chunks[0], {
            parse_mode: "Markdown",
          })
          .catch(() => ctx.api.editMessageText(chatId, sentMessageId!, chunks[0]));
      } catch {
        await sendChunk(ctx, chunks[0]);
      }
    } else {
      for (const chunk of chunks) {
        await sendChunk(ctx, chunk);
      }
    }
  } catch (err) {
    clearInterval(typingInterval);
    log.error({ err, chatId }, "Error handling message");
    await ctx.reply("⚠️ Something went wrong. Try /new to start a fresh session.");
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
