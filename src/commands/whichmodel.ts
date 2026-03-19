import type { Context } from "grammy";
import { formatChatModelContextMarkdown, getChatModelContext } from "./model-context";

export async function handleWhichModel(ctx: Context) {
  if (!ctx.chat) {
    await ctx.reply("Unable to determine chat model without chat context.");
    return;
  }

  const context = getChatModelContext(String(ctx.chat.id));
  await ctx.reply(formatChatModelContextMarkdown(context), { parse_mode: "Markdown" });
}
