import type { Context } from "grammy";
import { loadSoul } from "../memory/index.js";

export async function handleSoul(ctx: Context) {
  const soul = await loadSoul();
  const display = soul.length > 4000 ? soul.slice(0, 3997) + "..." : soul;
  await ctx.reply(display, { parse_mode: "Markdown" }).catch(() => ctx.reply(display));
}
