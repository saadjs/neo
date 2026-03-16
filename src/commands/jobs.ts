import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { listJobs, getJobRuns, setJobEnabled, deleteJob } from "../scheduler/jobs-db.js";
import { getRunningJob, cancelRunningJob } from "../scheduler/job-runner.js";
import { describeCron } from "../scheduler/cron.js";
import { getLogger } from "../logging/index.js";
import type { Job, JobRun } from "../scheduler/jobs-db.js";
import { ACTION_PICKER_TTL_MS, ACTION_PICKER_MAX, JOB_ERROR_MAX_CHARS } from "../constants.js";

interface JobPickerState {
  createdAt: number;
  jobs: Job[];
}

const jobPickers = new Map<string, JobPickerState>();

function pruneExpiredPickers(now = Date.now()): void {
  for (const [id, picker] of jobPickers) {
    if (now - picker.createdAt > ACTION_PICKER_TTL_MS) {
      jobPickers.delete(id);
    }
  }
  while (jobPickers.size > ACTION_PICKER_MAX) {
    const oldest = jobPickers.keys().next().value;
    if (!oldest) break;
    jobPickers.delete(oldest);
  }
}

function createPickerId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function formatNextRun(nextRunAt: string): string {
  const date = new Date(nextRunAt);
  return date.toISOString().replace("T", " ").slice(0, 16);
}

function buildJobListText(jobs: Job[]): string {
  if (jobs.length === 0) return "No scheduled jobs.";

  const running = getRunningJob();
  const lines: string[] = [`📋 Jobs (${jobs.length} total)`, ""];

  for (const job of jobs) {
    const status = job.enabled ? "enabled" : "disabled";
    const icon = job.enabled ? "▶️" : "⏸";
    const desc = describeCron(job.cron_expression);
    const next = job.enabled ? ` — next: ${formatNextRun(job.next_run_at)}` : "";
    lines.push(`${icon} ${job.name} — ${desc} — ${status}${next}`);
  }

  if (running) {
    lines.push("");
    lines.push(`🔄 Running: ${running.jobName}`);
  }

  return lines.join("\n");
}

function buildJobListKeyboard(pickerId: string, jobs: Job[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const running = getRunningJob();

  for (const job of jobs) {
    const toggleLabel = job.enabled ? `⏸ Pause ${job.name}` : `▶️ Resume ${job.name}`;
    keyboard.text(toggleLabel, `job:toggle:${pickerId}:${job.id}`);
    keyboard.text(`📜 History`, `job:history:${pickerId}:${job.id}`);
    keyboard.text(`🗑 Delete`, `job:delete:${pickerId}:${job.id}`);
    keyboard.row();
  }

  if (running) {
    keyboard.text("❌ Cancel Running Job", `job:cancel:${pickerId}`);
    keyboard.row();
  }

  return keyboard;
}

function buildJobHistoryText(job: Job, runs: JobRun[]): string {
  const lines: string[] = [`📜 History for "${job.name}" (last ${runs.length})`, ""];

  if (runs.length === 0) {
    lines.push("No runs yet.");
    return lines.join("\n");
  }

  for (const run of runs) {
    const icon = run.status === "completed" ? "✅" : run.status === "running" ? "🔄" : "❌";
    const duration = run.duration_ms != null ? ` (${formatDuration(run.duration_ms)})` : "";
    const time = run.started_at.replace("T", " ").slice(0, 16);
    lines.push(`${icon} ${run.status}${duration} — ${time}`);
    if (run.error) {
      lines.push(`   Error: ${run.error.slice(0, JOB_ERROR_MAX_CHARS)}`);
    }
  }

  return lines.join("\n");
}

export function isJobsCallback(data: string | undefined): boolean {
  return typeof data === "string" && data.startsWith("job:");
}

type ParsedCallback =
  | { action: "toggle"; pickerId: string; jobId: number }
  | { action: "history"; pickerId: string; jobId: number }
  | { action: "delete"; pickerId: string; jobId: number }
  | { action: "cancel"; pickerId: string }
  | { action: "back"; pickerId: string };

function parseCallbackData(data: string): ParsedCallback | null {
  const parts = data.split(":");
  if (parts[0] !== "job") return null;

  const action = parts[1];
  const pickerId = parts[2];

  if ((action === "toggle" || action === "history" || action === "delete") && parts.length === 4) {
    const jobId = Number(parts[3]);
    if (!Number.isInteger(jobId) || jobId < 0) return null;
    return { action, pickerId, jobId };
  }

  if (action === "cancel" && parts.length === 3) {
    return { action: "cancel", pickerId };
  }

  if (action === "back" && parts.length === 3) {
    return { action: "back", pickerId };
  }

  return null;
}

export async function handleJobs(ctx: Context) {
  const text = ctx.message?.text ?? "";
  const args = text.replace(/^\/jobs\s*/, "").trim();

  // /jobs history <name>
  const historyMatch = args.match(/^history\s+(.+)$/i);
  if (historyMatch) {
    const name = historyMatch[1].trim();
    const jobs = listJobs();
    const job = jobs.find((j) => j.name === name);
    if (!job) {
      await ctx.reply(`No job named "${name}".`);
      return;
    }
    const runs = getJobRuns(job.id, 5);
    await ctx.reply(buildJobHistoryText(job, runs));
    return;
  }

  // /jobs cancel
  if (args === "cancel") {
    const result = await cancelRunningJob();
    await ctx.reply(result === "cancelled" ? "Job cancelled." : "No job is currently running.");
    return;
  }

  // Default: list with buttons
  const jobs = listJobs();

  pruneExpiredPickers();
  const pickerId = createPickerId();

  jobPickers.set(pickerId, {
    createdAt: Date.now(),
    jobs,
  });

  const message = buildJobListText(jobs);
  const keyboard = jobs.length > 0 ? buildJobListKeyboard(pickerId, jobs) : undefined;

  await ctx.reply(message, { reply_markup: keyboard });
}

export async function handleJobsCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const parsed = data ? parseCallbackData(data) : null;
  const message = ctx.callbackQuery?.message;

  if (!parsed || !message || !("message_id" in message) || !ctx.chat) {
    await ctx.answerCallbackQuery({ text: "This picker is no longer available." });
    return;
  }

  const picker = jobPickers.get(parsed.pickerId);
  if (!picker) {
    await ctx.answerCallbackQuery({ text: "This picker expired. Send /jobs again." });
    return;
  }

  const log = getLogger();

  try {
    if (parsed.action === "toggle") {
      const job = picker.jobs.find((j) => j.id === parsed.jobId);
      if (!job) {
        await ctx.answerCallbackQuery({ text: "Job not found." });
        return;
      }

      const newEnabled = !job.enabled;
      setJobEnabled(job.id, newEnabled);
      job.enabled = newEnabled ? 1 : 0;

      // Refresh job list from DB for accurate state
      picker.jobs = listJobs();

      const text = buildJobListText(picker.jobs);
      const keyboard = buildJobListKeyboard(parsed.pickerId, picker.jobs);
      await ctx.api.editMessageText(ctx.chat.id, message.message_id, text, {
        reply_markup: keyboard,
      });
      await ctx.answerCallbackQuery({
        text: `${job.name} ${newEnabled ? "enabled" : "disabled"}`,
      });
      return;
    }

    if (parsed.action === "history") {
      const job = picker.jobs.find((j) => j.id === parsed.jobId);
      if (!job) {
        await ctx.answerCallbackQuery({ text: "Job not found." });
        return;
      }

      const runs = getJobRuns(job.id, 3);
      const text = buildJobHistoryText(job, runs);
      const keyboard = new InlineKeyboard().text("⬅️ Back", `job:back:${parsed.pickerId}`);
      await ctx.api.editMessageText(ctx.chat.id, message.message_id, text, {
        reply_markup: keyboard,
      });
      await ctx.answerCallbackQuery();
      return;
    }

    if (parsed.action === "delete") {
      const jobIndex = picker.jobs.findIndex((j) => j.id === parsed.jobId);
      if (jobIndex === -1) {
        await ctx.answerCallbackQuery({ text: "Job not found." });
        return;
      }

      const job = picker.jobs[jobIndex];
      deleteJob(job.id);
      picker.jobs.splice(jobIndex, 1);

      const text = buildJobListText(picker.jobs);
      if (picker.jobs.length === 0) {
        jobPickers.delete(parsed.pickerId);
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, text);
      } else {
        const keyboard = buildJobListKeyboard(parsed.pickerId, picker.jobs);
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, text, {
          reply_markup: keyboard,
        });
      }
      await ctx.answerCallbackQuery({ text: `${job.name} deleted` });
      return;
    }

    if (parsed.action === "cancel") {
      const result = await cancelRunningJob();
      if (result === "no-job-running") {
        await ctx.answerCallbackQuery({ text: "No job is currently running." });
        return;
      }

      // Refresh state
      picker.jobs = listJobs();
      const text = buildJobListText(picker.jobs);
      const keyboard = buildJobListKeyboard(parsed.pickerId, picker.jobs);
      await ctx.api.editMessageText(ctx.chat.id, message.message_id, text, {
        reply_markup: keyboard,
      });
      await ctx.answerCallbackQuery({ text: "Job cancelled" });
      return;
    }

    if (parsed.action === "back") {
      // Refresh and show the job list again
      picker.jobs = listJobs();
      const text = buildJobListText(picker.jobs);
      const keyboard =
        picker.jobs.length > 0 ? buildJobListKeyboard(parsed.pickerId, picker.jobs) : undefined;
      await ctx.api.editMessageText(ctx.chat.id, message.message_id, text, {
        reply_markup: keyboard,
      });
      await ctx.answerCallbackQuery();
      return;
    }
  } catch (err) {
    log.warn({ err }, "Jobs callback failed");
    await ctx.answerCallbackQuery({ text: "Action failed. Try /jobs again." });
  }
}
