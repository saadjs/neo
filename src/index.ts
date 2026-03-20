import { config, ensureDataDir } from "./config";
import { createLogger } from "./logging/index";
import { closeConversationDb } from "./logging/conversations";
import { startAgent, stopAgent } from "./agent";
import { createBot } from "./bot";
import { getOwnerNotificationTarget, startScheduler, stopScheduler } from "./scheduler/index";
import { closeAllBrowserSessions } from "./tools/browser-runtime";
import { notifyText } from "./transport/notifier";
import { createTelegramConversationRefFromId } from "./transport/telegram-utils";
import {
  consumeRestartMarker,
  formatSystemStatusSummary,
  getSystemStatus,
  logAutonomyStartup,
} from "./runtime/state";

async function main() {
  const log = await createLogger(config.logging.level, config.paths.logs);
  log.info({ pid: process.pid }, "Neo starting up...");

  const { isFirstRun } = await ensureDataDir();

  const restartInfo = await consumeRestartMarker();
  await logAutonomyStartup(restartInfo);
  if (restartInfo) {
    log.info({ restartInfo }, "Restart marker found — this is a restart");
  }

  await startAgent();
  log.info("Copilot agent ready");

  const bot = await createBot();

  startScheduler();

  const startupStatus = await getSystemStatus();
  log.info({ startupStatus }, "Runtime status on startup");

  if (restartInfo?.chatId) {
    try {
      await notifyText(
        { conversation: createTelegramConversationRefFromId(restartInfo.chatId) },
        `Back online. ⚡\n${formatSystemStatusSummary(startupStatus)}`,
      );
    } catch (err) {
      log.warn({ err }, "Failed to send restart notification");
    }
  }

  if (isFirstRun && !restartInfo) {
    try {
      await notifyText(
        getOwnerNotificationTarget(),
        "Hey, just came online for the first time. How would you like my personality to be?",
      );
    } catch (err) {
      log.warn({ err }, "Failed to send onboarding greeting");
    }
  }

  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutting down...");
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

  log.info("Neo is online. Listening for messages.");
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
