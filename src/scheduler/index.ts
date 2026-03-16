import type { Api } from "grammy";
import { getLogger } from "../logging/index.js";
import { config } from "../config.js";
import { initRemindersTable, getDueReminders, markFired } from "./db.js";
import { executeJob } from "./job-runner.js";
import { initJobsTable, getDueJobs, advanceNextRun } from "./jobs-db.js";
import { runMemoryDecay } from "../memory/index.js";

import { HEARTBEAT_MS } from "../constants.js";

let intervalId: ReturnType<typeof setInterval> | null = null;
const claimedWeeklyMemoryDecayRuns = new Set<string>();

export function startScheduler(api: Api): void {
  const log = getLogger();

  initRemindersTable();
  initJobsTable();
  log.info("Scheduler started (30s heartbeat)");

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

async function tick(api: Api): Promise<void> {
  const log = getLogger();
  const now = new Date().toISOString();
  const dueReminders = getDueReminders(now);
  const dueJobs = getDueJobs(now);

  for (const reminder of dueReminders) {
    const text = `Reminder: ${reminder.label}\n\n${reminder.message}`;
    try {
      await api.sendMessage(config.telegram.ownerId, text);
    } catch (err) {
      log.error({ err, reminderId: reminder.id }, "Failed to send reminder");
    }
    // Mark fired regardless to avoid infinite retries
    markFired(reminder.id, reminder.recurrence);
  }

  for (const job of dueJobs) {
    advanceNextRun(job.id);
    void executeJob(job, api).catch((err) => {
      log.error({ err, jobId: job.id, jobName: job.name }, "Job execution failed");
    });
  }

  // Run memory decay weekly on Sundays at 3 AM (within the 30s heartbeat window)
  const tickDate = new Date();
  if (shouldStartWeeklyMemoryDecay(tickDate)) {
    runMemoryDecay().catch((err) => log.error({ err }, "Memory decay failed"));
  }
}
