import type { Context } from "grammy";

const HELP_TEXT = `**Neo — Commands**

/new — Start a fresh conversation
/model <name> — Switch the model for this chat only
/sessions — List active sessions
/memory [query] — View or search memory
/loglevel <level> — Set log verbosity
/soul — Show current persona
/status — Show runtime status
/restart — Restart Neo

Notes:
- /new keeps this chat's model override if you set one with /model
- Otherwise /new uses Neo's default model from config.json

Just send a message to chat.`;

export async function handleHelp(ctx: Context) {
  await ctx.reply(HELP_TEXT, { parse_mode: "Markdown" });
}
