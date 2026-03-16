import type { Context } from "grammy";
import {
  isChannelChat,
  loadPreferences,
  readDailyMemory,
  searchMemory,
  listMemoryFiles,
} from "../memory/index.js";
import { searchSessionsByTag } from "../logging/conversations.js";
import { truncateTelegramMessage } from "../telegram/messages.js";

export async function handleMemory(ctx: Context) {
  const text = ctx.message?.text ?? "";
  const arg = text.replace(/^\/memory\s*/, "").trim();
  const chatId = ctx.chat?.id;
  const channelId = chatId != null && isChannelChat(chatId) ? chatId : undefined;

  if (!arg) {
    // Show summary
    const files = await listMemoryFiles(channelId);
    const prefs = await loadPreferences();
    const today = await readDailyMemory(undefined, channelId);

    let msg = `**Memory overview:**\n`;
    msg += `• ${files.length} daily memory file(s)\n`;
    msg += `• Preferences: ${prefs.split("\n").length - 1} entries\n`;
    if (today.trim()) {
      msg += `\n**Today's memory:**\n${today.slice(0, 1000)}`;
    }
    await ctx.reply(msg, { parse_mode: "Markdown" });
    return;
  }

  if (arg.startsWith("#")) {
    const tag = arg.slice(1).trim().toLowerCase();
    if (!tag) {
      await ctx.reply("Usage: /memory #tag");
      return;
    }
    const sessions = searchSessionsByTag(tag, 10);
    if (sessions.length === 0) {
      await ctx.reply(`No sessions found with tag "${tag}".`);
      return;
    }
    let msg = `🏷️ Sessions tagged "${tag}":\n\n`;
    for (const s of sessions) {
      const date = s.created_at.split("T")[0] ?? s.created_at.slice(0, 10);
      const tags = s.tags ?? "";
      msg += `• ${date} — ${s.model ?? "unknown"} [${tags}]\n`;
    }
    const replyText = truncateTelegramMessage(msg);
    await ctx.reply(replyText).catch(() => ctx.reply(replyText));
    return;
  }

  if (arg === "recent" || arg.startsWith("recent ")) {
    const parts = arg.split(/\s+/);
    const days = parts.length > 1 ? parseInt(parts[1], 10) || 3 : 3;
    const maxDays = Math.min(days, 14);

    let msg = `📅 Recent memory (last ${maxDays} days):\n\n`;
    let hasContent = false;

    for (let i = 0; i < maxDays; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      const content = await readDailyMemory(dateStr, channelId);
      if (content.trim()) {
        hasContent = true;
        const preview = content.trim().slice(0, 500);
        msg += `**${dateStr}**\n${preview}\n\n`;
      }
    }

    if (!hasContent) {
      msg += "No memory entries found for this period.";
    }

    const replyText = truncateTelegramMessage(msg);
    await ctx.reply(replyText, { parse_mode: "Markdown" }).catch(() => ctx.reply(replyText));
    return;
  }

  // FTS search
  const results = await searchMemory(arg, channelId);
  const replyText = truncateTelegramMessage(results);
  await ctx.reply(replyText, { parse_mode: "Markdown" }).catch(() => ctx.reply(replyText));
}
