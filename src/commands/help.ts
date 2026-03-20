import type { Context } from "grammy";
import { buildHelpText } from "./definitions";
import { getChatModelContext } from "./model-context";

export async function handleHelp(ctx: Context) {
  if (!ctx.chat) {
    await ctx.reply(buildHelpText(), { parse_mode: "Markdown" });
    return;
  }

  const context = getChatModelContext(ctx.chat.id);
  let intro: string;
  if (context.overrideActive) {
    intro = `Hey — using \`${context.currentModel}\` (per-chat override, default is \`${context.defaultModel}\`).\n\n`;
  } else if (context.channelDefaultModel) {
    intro = `Hey — using \`${context.currentModel}\` (channel default).\n\n`;
  } else {
    intro = `Hey — using \`${context.currentModel}\` (global default).\n\n`;
  }

  await ctx.reply(`${intro}${buildHelpText()}`, { parse_mode: "Markdown" });
}
