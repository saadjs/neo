import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import {
  initJobsTable,
  createJob,
  getJob,
  getJobByName,
  listJobs,
  updateJob,
  deleteJob,
  setJobEnabled,
  getJobRuns,
} from "../scheduler/jobs-db";
import { getConversationDb } from "../logging/conversations";
import { isValidCron } from "../scheduler/cron";
import { createAuditTimer } from "../logging/audit";
import { cancelRunningJob } from "../scheduler/job-state";

function resolveJob(args: { id?: number; name?: string }) {
  if (args.id != null) return getJob(args.id);
  if (args.name != null) return getJobByName(args.name);
  return undefined;
}

export const jobTool = defineTool("job", {
  description:
    "Manage scheduled jobs that execute AI prompts on a cron schedule. Jobs run automatically and send their output to the owner. Use standard 5-field cron expressions (min hour dom month dow). All times are UTC.",
  parameters: z.object({
    action: z
      .enum([
        "create",
        "list",
        "get",
        "update",
        "delete",
        "enable",
        "disable",
        "history",
        "run_now",
        "cancel",
      ])
      .describe("The job action to perform"),
    name: z
      .string()
      .optional()
      .describe("Job name (required for create, used as identifier for other actions)"),
    prompt: z
      .string()
      .optional()
      .describe("The AI prompt to execute on schedule (required for create)"),
    cron_expression: z
      .string()
      .optional()
      .describe("Standard 5-field cron expression: min hour dom month dow (required for create)"),
    id: z.number().optional().describe("Job ID (alternative to name for identifying a job)"),
    limit: z.number().optional().describe("Number of history entries to return (default: 10)"),
  }),
  handler: async (args, invocation) => {
    const audit = createAuditTimer(invocation.sessionId, "job", args as Record<string, unknown>);

    try {
      initJobsTable();

      if (args.action === "cancel") {
        const status = await cancelRunningJob();
        const result =
          status === "cancelled"
            ? "Cancelling running job. Abort signal sent."
            : "No job is currently running.";
        audit.complete(result);
        return result;
      }

      const { action, ...rest } = args;
      const result = execute({ action, ...rest });
      audit.complete(result);
      return result;
    } catch (error) {
      const message = `job tool error: ${String(error)}`;
      audit.complete(message);
      return message;
    }
  },
});

function execute(args: {
  action:
    | "create"
    | "list"
    | "get"
    | "update"
    | "delete"
    | "enable"
    | "disable"
    | "history"
    | "run_now";
  name?: string;
  prompt?: string;
  cron_expression?: string;
  id?: number;
  limit?: number;
}): string {
  switch (args.action) {
    case "create": {
      if (!args.name) return "Error: name is required for create action.";
      if (!args.prompt) return "Error: prompt is required for create action.";
      if (!args.cron_expression) return "Error: cron_expression is required for create action.";
      if (!isValidCron(args.cron_expression))
        return `Error: invalid cron expression "${args.cron_expression}". Use 5-field format: min hour dom month dow.`;

      const id = createJob(args.name, args.prompt, args.cron_expression);
      const job = getJob(id)!;
      return `Job created (id: ${id}, name: "${args.name}"). Next run at ${job.next_run_at}.`;
    }

    case "list": {
      const jobs = listJobs();
      if (jobs.length === 0) return "No scheduled jobs.";

      const lines = jobs.map(
        (j) =>
          `#${j.id} | ${j.name} | ${j.enabled ? "enabled" : "disabled"} | cron: ${j.cron_expression} | next: ${j.next_run_at}`,
      );
      return `Scheduled jobs:\n${lines.join("\n")}`;
    }

    case "get": {
      const job = resolveJob(args);
      if (!job) return "Error: job not found. Provide a valid id or name.";

      const runs = getJobRuns(job.id, 5);
      const runLines =
        runs.length > 0
          ? runs
              .map(
                (r) => `  Run #${r.id} | ${r.status} | ${r.started_at} | ${r.duration_ms ?? "-"}ms`,
              )
              .join("\n")
          : "  No runs yet.";

      return [
        `Job #${job.id}: ${job.name}`,
        `Status: ${job.enabled ? "enabled" : "disabled"}`,
        `Cron: ${job.cron_expression}`,
        `Next run: ${job.next_run_at}`,
        `Prompt: ${job.prompt}`,
        `Created: ${job.created_at}`,
        `Recent runs:\n${runLines}`,
      ].join("\n");
    }

    case "update": {
      const job = resolveJob(args);
      if (!job) return "Error: job not found. Provide a valid id or name.";

      const fields: Record<string, string> = {};
      if (args.prompt !== undefined) fields.prompt = args.prompt;
      if (args.cron_expression !== undefined) {
        if (!isValidCron(args.cron_expression))
          return `Error: invalid cron expression "${args.cron_expression}".`;
        fields.cron_expression = args.cron_expression;
      }
      // Allow renaming via a new name if the job was resolved by id
      if (args.name !== undefined && args.id != null) fields.name = args.name;

      if (Object.keys(fields).length === 0)
        return "Error: no fields to update. Provide prompt, cron_expression, or name.";

      const updated = updateJob(job.id, fields);
      return updated ? `Job #${job.id} updated.` : `No changes made to job #${job.id}.`;
    }

    case "delete": {
      const job = resolveJob(args);
      if (!job) return "Error: job not found. Provide a valid id or name.";

      const deleted = deleteJob(job.id);
      return deleted
        ? `Job #${job.id} ("${job.name}") deleted.`
        : `Failed to delete job #${job.id}.`;
    }

    case "enable": {
      const job = resolveJob(args);
      if (!job) return "Error: job not found. Provide a valid id or name.";

      setJobEnabled(job.id, true);
      return `Job #${job.id} ("${job.name}") enabled.`;
    }

    case "disable": {
      const job = resolveJob(args);
      if (!job) return "Error: job not found. Provide a valid id or name.";

      setJobEnabled(job.id, false);
      return `Job #${job.id} ("${job.name}") disabled.`;
    }

    case "history": {
      const job = resolveJob(args);
      if (!job) return "Error: job not found. Provide a valid id or name.";

      const runs = getJobRuns(job.id, args.limit ?? 10);
      if (runs.length === 0) return `No run history for job "${job.name}".`;

      const lines = runs.map((r) => {
        const info = [`Run #${r.id}`, r.status, r.started_at];
        if (r.duration_ms != null) info.push(`${r.duration_ms}ms`);
        if (r.error) info.push(`error: ${r.error}`);
        return info.join(" | ");
      });
      return `Run history for "${job.name}":\n${lines.join("\n")}`;
    }

    case "run_now": {
      const job = resolveJob(args);
      if (!job) return "Error: job not found. Provide a valid id or name.";

      const db = getConversationDb();
      db.prepare("UPDATE jobs SET next_run_at = ?, updated_at = datetime('now') WHERE id = ?").run(
        new Date().toISOString(),
        job.id,
      );
      return `Job #${job.id} ("${job.name}") scheduled to run immediately. The scheduler will pick it up within 30 seconds.`;
    }
  }
}
