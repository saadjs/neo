import type { Context } from "grammy";
import { switchModel } from "../agent.js";

export async function handleModel(ctx: Context) {
  const text = ctx.message?.text ?? "";
  const model = text.replace(/^\/model\s*/, "").trim();

  if (!model) {
    await ctx.reply("Usage: `/model <name>`\nExample: `/model gpt-4.1`", {
      parse_mode: "Markdown",
    });
    return;
  }

  try {
    await switchModel(ctx.chat!.id, model);
    await ctx.reply(`Model switched to \`${model}\`.`, { parse_mode: "Markdown" });
  } catch (err) {
    await ctx.reply(`Failed to switch model: ${err}`);
  }
}
