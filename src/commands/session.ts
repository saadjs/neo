import type { Context } from "grammy";
import { createNewSession, listActiveSessions, destroySession } from "../agent.js";
import { getLogger } from "../logging/index.js";

export async function handleNewSession(ctx: Context) {
  const chatId = ctx.chat!.id;
  const log = getLogger();

  await destroySession(chatId);
  await createNewSession({ chatId });

  log.info({ chatId }, "New session created via /new");
  await ctx.reply("Fresh session. What's up?");
}

export async function handleSessions(ctx: Context) {
  const active = listActiveSessions();
  if (active.length === 0) {
    await ctx.reply("No active sessions.");
    return;
  }

  const lines = active.map((s) => `• Chat ${s.chatId} → \`${s.sessionId.slice(0, 8)}…\``);
  await ctx.reply(`**Active sessions:**\n${lines.join("\n")}`, {
    parse_mode: "Markdown",
  });
}
