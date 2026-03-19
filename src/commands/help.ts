import type { Context } from "grammy";
import { buildHelpText } from "./definitions";
import { getChatModelContext } from "./model-context";

export async function handleHelp(ctx: Context) {
  if (!ctx.chat) {
    await ctx.reply(buildHelpText(), { parse_mode: "Markdown" });
    return;
  }

  const context = getChatModelContext(String(ctx.chat.id));
  const intro = context.overrideActive
    ? `Hey — default model is \`${context.defaultModel}\`, but this chat is using \`${context.currentModel}\`.\n\n`
    : `Hey — default model is \`${context.defaultModel}\`, and this chat is using it.\n\n`;

  await ctx.reply(`${intro}${buildHelpText()}`, { parse_mode: "Markdown" });
}
