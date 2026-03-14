import type { Context } from "grammy";
import { buildHelpText } from "./definitions.js";

export async function handleHelp(ctx: Context) {
  await ctx.reply(buildHelpText(), { parse_mode: "Markdown" });
}
