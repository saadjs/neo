import type { Context } from "grammy";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { getLogger } from "../logging/index.js";

export async function handleRestart(ctx: Context) {
  const log = getLogger();

  await ctx.reply("Restarting… be right back.");
  log.info("Restart requested via /restart");

  // Write restart marker so we know it was intentional on boot
  const markerPath = join(config.paths.data, ".restart-marker");
  await writeFile(markerPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    chatId: ctx.chat!.id,
    source: "telegram-command",
  }), "utf-8");

  // Give the message time to send, then exit (systemd restarts us)
  setTimeout(() => process.exit(0), 500);
}
