import type { SQLInputValue } from "node:sqlite";
import { getConversationDb } from "../logging/conversations";
import { getNextCronTime } from "./cron";

export interface Job {
  id: number;
  name: string;
  prompt: string;
  cron_expression: string;
  enabled: number;
  next_run_at: string;
  created_at: string;
  updated_at: string;
}

export interface JobRun {
  id: number;
  job_id: number;
  status: string;
  output: string | null;
  error: string | null;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
}

export function initJobsTable(): void {
  const db = getConversationDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      prompt TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_enabled_next ON jobs(enabled, next_run_at);

    CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running',
      output TEXT,
      error TEXT,
      duration_ms INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_id, started_at);
  `);

  // Restart recovery: mark orphaned running runs as failed
  db.prepare(
    "UPDATE job_runs SET status = 'failed', error = 'Process restarted', completed_at = datetime('now') WHERE status = 'running'",
  ).run();
}

export function createJob(name: string, prompt: string, cronExpression: string): number {
  const db = getConversationDb();
  const nextRun = getNextCronTime(cronExpression, new Date()).toISOString();
  const result = db
    .prepare("INSERT INTO jobs (name, prompt, cron_expression, next_run_at) VALUES (?, ?, ?, ?)")
    .run(name, prompt, cronExpression, nextRun);
  return Number(result.lastInsertRowid);
}

export function getJob(id: number): Job | undefined {
  const db = getConversationDb();
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job | undefined;
}

export function getJobByName(name: string): Job | undefined {
  const db = getConversationDb();
  return db.prepare("SELECT * FROM jobs WHERE name = ?").get(name) as Job | undefined;
}

export function listJobs(): Job[] {
  const db = getConversationDb();
  return db
    .prepare("SELECT * FROM jobs ORDER BY enabled DESC, next_run_at ASC")
    .all() as unknown as Job[];
}

export function updateJob(
  id: number,
  fields: Partial<Pick<Job, "name" | "prompt" | "cron_expression">>,
): boolean {
  const db = getConversationDb();
  const sets: string[] = [];
  const values: SQLInputValue[] = [];

  if (fields.name !== undefined) {
    sets.push("name = ?");
    values.push(fields.name);
  }
  if (fields.prompt !== undefined) {
    sets.push("prompt = ?");
    values.push(fields.prompt);
  }
  if (fields.cron_expression !== undefined) {
    sets.push("cron_expression = ?");
    values.push(fields.cron_expression);
    // Recalculate next run
    const nextRun = getNextCronTime(fields.cron_expression, new Date()).toISOString();
    sets.push("next_run_at = ?");
    values.push(nextRun);
  }

  if (sets.length === 0) return false;

  sets.push("updated_at = datetime('now')");
  values.push(id);

  const result = db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteJob(id: number): boolean {
  const db = getConversationDb();
  const result = db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
  return result.changes > 0;
}

export function setJobEnabled(id: number, enabled: boolean): boolean {
  const db = getConversationDb();
  const result = db
    .prepare("UPDATE jobs SET enabled = ?, updated_at = datetime('now') WHERE id = ?")
    .run(enabled ? 1 : 0, id);
  return result.changes > 0;
}

export function getDueJobs(now: string): Job[] {
  const db = getConversationDb();
  return db
    .prepare("SELECT * FROM jobs WHERE enabled = 1 AND next_run_at <= ?")
    .all(now) as unknown as Job[];
}

export function advanceNextRun(jobId: number): void {
  const db = getConversationDb();
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | undefined;
  if (!job) return;

  const nextRun = getNextCronTime(job.cron_expression, new Date()).toISOString();
  db.prepare("UPDATE jobs SET next_run_at = ?, updated_at = datetime('now') WHERE id = ?").run(
    nextRun,
    jobId,
  );
}

export function createJobRun(jobId: number): number {
  const db = getConversationDb();
  const result = db.prepare("INSERT INTO job_runs (job_id) VALUES (?)").run(jobId);
  return Number(result.lastInsertRowid);
}

export function completeJobRun(runId: number, output: string, durationMs: number): void {
  const db = getConversationDb();
  db.prepare(
    "UPDATE job_runs SET status = 'completed', output = ?, duration_ms = ?, completed_at = datetime('now') WHERE id = ?",
  ).run(output, durationMs, runId);
}

export function failJobRun(runId: number, error: string, durationMs: number): void {
  const db = getConversationDb();
  db.prepare(
    "UPDATE job_runs SET status = 'failed', error = ?, duration_ms = ?, completed_at = datetime('now') WHERE id = ?",
  ).run(error, durationMs, runId);
}

export function getJobRuns(jobId: number, limit: number = 10): JobRun[] {
  const db = getConversationDb();
  return db
    .prepare("SELECT * FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?")
    .all(jobId, limit) as unknown as JobRun[];
}
