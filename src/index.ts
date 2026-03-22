import { config, ensureDataDir } from "./config";
import { createLogger } from "./logging/index";
import { closeConversationDb } from "./logging/conversations";
import { startAgent, stopAgent } from "./agent";
import { createBot } from "./bot";
import { startScheduler, stopScheduler } from "./scheduler/index";
import { closeAllBrowserSessions } from "./tools/browser-runtime";
import { setTelegramApi } from "./telegram/runtime";
import {
  consumeRestartMarker,
  formatSystemStatusSummary,
  getSystemStatus,
  logAutonomyStartup,
} from "./runtime/state";
import { markShuttingDown } from "./lifecycle";

async function main() {
  // Initialize logger first
  const log = await createLogger(config.logging.level, config.paths.logs);
  log.info({ pid: process.pid }, "Neo starting up...");

  // Ensure data directories exist
  const { isFirstRun } = await ensureDataDir();

  // Check for restart marker
  const restartInfo = await consumeRestartMarker();
  await logAutonomyStartup(restartInfo);
  if (restartInfo) {
    log.info({ restartInfo }, "Restart marker found — this is a restart");
  }

  // Start the Copilot SDK client
  await startAgent();
  log.info("Copilot agent ready");

  // Create and start Telegram bot
  const bot = await createBot();
  setTelegramApi(bot.api);

  // Start reminder scheduler
  startScheduler(bot.api);

  const startupStatus = await getSystemStatus();
  log.info({ startupStatus }, "Runtime status on startup");

  // Send "I'm back" message after restart
  if (restartInfo?.chatId) {
    try {
      await bot.api.sendMessage(
        restartInfo.chatId,
        `Back online. ⚡\n${formatSystemStatusSummary(startupStatus)}`,
      );
    } catch (err) {
      log.warn({ err }, "Failed to send restart notification");
    }
  }

  // First-run onboarding greeting
  if (isFirstRun && !restartInfo) {
    try {
      await bot.api.sendMessage(
        config.telegram.ownerId,
        "Hey, just came online for the first time. How would you like my personality to be?",
      );
    } catch (err) {
      log.warn({ err }, "Failed to send onboarding greeting");
    }
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutting down...");
    markShuttingDown();
    stopScheduler();
    bot.runner.stop();
    await closeAllBrowserSessions();
    await stopAgent();
    closeConversationDb();
    log.info("Goodbye.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    log.error({ err: reason }, "Unhandled promise rejection");
  });

  log.info("Neo is online. Listening for messages.");
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
