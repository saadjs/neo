import { config } from "./config.js";
import { createLogger } from "./logging/index.js";
import { closeConversationDb } from "./logging/conversations.js";
import { ensureMemoryDir } from "./memory/index.js";
import { startAgent, stopAgent } from "./agent.js";
import { createBot } from "./bot.js";
import { startScheduler, stopScheduler } from "./scheduler/index.js";
import { closeAllBrowserSessions } from "./tools/browser-runtime.js";
import { setTelegramApi } from "./telegram/runtime.js";
import {
  consumeRestartMarker,
  formatSystemStatusSummary,
  getSystemStatus,
  logAutonomyStartup,
} from "./runtime/state.js";

async function main() {
  // Initialize logger first
  const log = await createLogger(config.logging.level, config.paths.logs);
  log.info({ pid: process.pid }, "Neo starting up...");

  // Ensure data directories exist
  await ensureMemoryDir();

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
  const bot = createBot();
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

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutting down...");
    stopScheduler();
    bot.stop();
    await closeAllBrowserSessions();
    await stopAgent();
    closeConversationDb();
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
