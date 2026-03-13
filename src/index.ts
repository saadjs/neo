import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { createLogger } from "./logging/index.js";
import { ensureMemoryDir } from "./memory/index.js";
import { startAgent, stopAgent } from "./agent.js";
import { createBot } from "./bot.js";

async function main() {
  // Initialize logger first
  const log = await createLogger(config.logging.level, config.paths.logs);
  log.info({ pid: process.pid }, "Neo starting up...");

  // Ensure data directories exist
  await ensureMemoryDir();

  // Check for restart marker
  const markerPath = join(config.paths.data, ".restart-marker");
  let restartInfo: { chatId?: number; timestamp?: string } | null = null;
  try {
    const marker = await readFile(markerPath, "utf-8");
    restartInfo = JSON.parse(marker);
    await unlink(markerPath);
    log.info({ restartInfo }, "Restart marker found — this is a restart");
  } catch {
    // No marker — fresh start
  }

  // Start the Copilot SDK client
  await startAgent();
  log.info("Copilot agent ready");

  // Create and start Telegram bot
  const bot = createBot();

  // Send "I'm back" message after restart
  if (restartInfo?.chatId) {
    try {
      await bot.api.sendMessage(restartInfo.chatId, "Back online. ⚡");
    } catch (err) {
      log.warn({ err }, "Failed to send restart notification");
    }
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutting down...");
    bot.stop();
    await stopAgent();
    log.info("Goodbye.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Start polling
  log.info("Telegram bot starting (long polling)...");
  bot.start({
    onStart: () => {
      log.info("Neo is online. Listening for messages.");
    },
  });
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
