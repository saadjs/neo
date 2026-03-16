import type { Context } from "grammy";
import { loadSoul } from "../memory/index";
import { truncateTelegramMessage } from "../telegram/messages";

export async function handleSoul(ctx: Context) {
  const soul = await loadSoul();
  const display = truncateTelegramMessage(soul, "...");
  await ctx.reply(display, { parse_mode: "Markdown" }).catch(() => ctx.reply(display));
}
