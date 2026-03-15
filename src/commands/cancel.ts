import type { Context } from "grammy";
import { abortSession } from "../agent.js";
import { getLogger } from "../logging/index.js";

export async function handleCancel(ctx: Context) {
  const chatId = ctx.chat!.id;
  const result = await abortSession(chatId);

  if (result === "no-session") {
    await ctx.reply("No active session.");
    return;
  }
  if (result === "no-active-turn") {
    await ctx.reply("Nothing is running right now.");
    return;
  }

  getLogger().info({ chatId }, "Turn aborted via /cancel");
  await ctx.reply("Cancelled.");
}
