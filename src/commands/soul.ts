import type { Context } from "grammy";
import { loadSoul } from "../memory/index.js";
import { truncateTelegramMessage } from "../telegram/messages.js";

export async function handleSoul(ctx: Context) {
  const soul = await loadSoul();
  const display = truncateTelegramMessage(soul, "...");
  await ctx.reply(display, { parse_mode: "Markdown" }).catch(() => ctx.reply(display));
}
