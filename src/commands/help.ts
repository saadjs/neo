import type { Context } from "grammy";

const HELP_TEXT = `**Neo — Commands**

/new — Start a fresh conversation
/model <name> — Switch LLM model
/sessions — List active sessions
/memory [query] — View or search memory
/loglevel <level> — Set log verbosity
/soul — Show current persona
/restart — Restart Neo

Just send a message to chat.`;

export async function handleHelp(ctx: Context) {
  await ctx.reply(HELP_TEXT, { parse_mode: "Markdown" });
}
