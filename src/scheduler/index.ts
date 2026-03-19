import { getLogger } from "../logging/index";
import { config } from "../config";
import { initRemindersTable, getDueReminders, markFired } from "./db";
import { executeJob } from "./job-runner";
import { initJobsTable, getDueJobs, advanceNextRun } from "./jobs-db";
import { runMemoryDecay } from "../memory/index";
import { HEARTBEAT_MS } from "../constants";
import type { NotificationTarget } from "../transport/types";
import { notifyText } from "../transport/notifier";
import { createTelegramConversationRef } from "../transport/telegram-utils";

let intervalId: ReturnType<typeof setInterval> | null = null;
const claimedWeeklyMemoryDecayRuns = new Set<string>();

export function getOwnerNotificationTarget(): NotificationTarget {
  return {
    conversation: createTelegramConversationRef({ id: config.telegram.ownerId }),
  };
}

export function startScheduler(): void {
  const log = getLogger();

  initRemindersTable();
  initJobsTable();
  log.info("Scheduler started (30s heartbeat)");

  intervalId = setInterval(() => {
    tick().catch((err) => {
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

export function shouldRunWeeklyMemoryDecay(date = new Date()): boolean {
  return date.getUTCDay() === 0 && date.getUTCHours() === 3 && date.getUTCMinutes() < 1;
}

function getWeeklyMemoryDecayRunKey(date: Date): string | null {
  if (!shouldRunWeeklyMemoryDecay(date)) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

export function shouldStartWeeklyMemoryDecay(date = new Date()): boolean {
  const runKey = getWeeklyMemoryDecayRunKey(date);
  if (!runKey || claimedWeeklyMemoryDecayRuns.has(runKey)) {
    return false;
  }

  claimedWeeklyMemoryDecayRuns.add(runKey);
  return true;
}

async function tick(): Promise<void> {
  const log = getLogger();
  const now = new Date().toISOString();
  const dueReminders = getDueReminders(now);
  const dueJobs = getDueJobs(now);
  const ownerTarget = getOwnerNotificationTarget();

  for (const reminder of dueReminders) {
    const text = `Reminder: ${reminder.label}\n\n${reminder.message}`;
    try {
      await notifyText(ownerTarget, text);
    } catch (err) {
      log.error({ err, reminderId: reminder.id }, "Failed to send reminder");
    }
    markFired(reminder.id, reminder.recurrence);
  }

  for (const job of dueJobs) {
    advanceNextRun(job.id);
    void executeJob(job, ownerTarget).catch((err) => {
      log.error({ err, jobId: job.id, jobName: job.name }, "Job execution failed");
    });
  }

  const tickDate = new Date();
  if (shouldStartWeeklyMemoryDecay(tickDate)) {
    runMemoryDecay().catch((err) => log.error({ err }, "Memory decay failed"));
  }
}
