import type { Context } from "grammy";
import { getLogger } from "../logging/index.js";
import { restartService } from "../runtime/state.js";

export async function handleRestart(ctx: Context) {
  const log = getLogger();

  await ctx.reply("Restarting… be right back.");
  log.info("Restart requested via /restart");
  await restartService({
    actor: "telegram-owner",
    source: "command",
    reason: "/restart command",
    chatId: ctx.chat!.id,
  });
}
