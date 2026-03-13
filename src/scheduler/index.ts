import type { Api } from "grammy";
import { getLogger } from "../logging/index.js";
import { config } from "../config.js";
import { initRemindersTable, getDueReminders, markFired } from "./db.js";

const HEARTBEAT_MS = 30_000;

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startScheduler(api: Api): void {
  const log = getLogger();

  initRemindersTable();
  log.info("Reminder scheduler started (30s heartbeat)");

  intervalId = setInterval(() => {
    tick(api).catch((err) => {
      log.error({ err }, "Scheduler tick failed");
    });
  }, HEARTBEAT_MS);
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function tick(api: Api): Promise<void> {
  const log = getLogger();
  const now = new Date().toISOString();
  const due = getDueReminders(now);

  for (const reminder of due) {
    const text = `Reminder: ${reminder.label}\n\n${reminder.message}`;
    try {
      await api.sendMessage(config.telegram.ownerId, text);
    } catch (err) {
      log.error({ err, reminderId: reminder.id }, "Failed to send reminder");
    }
    // Mark fired regardless to avoid infinite retries
    markFired(reminder.id, reminder.recurrence);
  }
}
