import type { Context } from "grammy";
import { abortSession } from "../agent";
import { getLogger } from "../logging/index";
import { cancelPendingUserInput } from "../telegram/user-input";

export async function handleCancel(ctx: Context) {
  const chatId = String(ctx.chat!.id);
  const result = await abortSession(chatId);

  if (result === "no-session") {
    await ctx.reply("No active session.");
    return;
  }
  if (result === "no-active-turn") {
    await ctx.reply("Nothing is running right now.");
    return;
  }

  await cancelPendingUserInput(chatId, "Cancelled via /cancel.");

  getLogger().info({ chatId }, "Turn aborted via /cancel");
  await ctx.reply("Cancelled.");
}
