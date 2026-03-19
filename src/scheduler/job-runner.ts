import type { SessionEvent } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import { getClient } from "../agent";
import { config } from "../config";
import { allTools } from "../tools/index";
import { buildSystemContext } from "../memory/index";
import { getLogger } from "../logging/index";
import { preToolUse } from "../hooks/pre-tool";
import { splitMessage } from "../telegram/messages";
import { createJobRun, completeJobRun, failJobRun } from "./jobs-db";
import type { Job } from "./jobs-db";
import type { NotificationTarget } from "../transport/types";
import { notifyText } from "../transport/notifier";

let runningJob: {
  jobId: number;
  jobName: string;
  session: { abort(): Promise<void>; destroy(): Promise<void> };
  responseBuffer: string;
  cancelled: boolean;
} | null = null;

export function isJobRunning(): boolean {
  return runningJob !== null;
}

export function getRunningJob(): { jobId: number; jobName: string } | null {
  if (!runningJob) return null;
  return { jobId: runningJob.jobId, jobName: runningJob.jobName };
}

export async function cancelRunningJob(): Promise<"cancelled" | "no-job-running"> {
  if (!runningJob) return "no-job-running";
  const log = getLogger();
  log.info({ jobId: runningJob.jobId, jobName: runningJob.jobName }, "Cancelling running job");
  runningJob.cancelled = true;
  await runningJob.session.abort();
  return "cancelled";
}

export async function executeJob(job: Job, target: NotificationTarget): Promise<void> {
  const log = getLogger();

  if (runningJob) {
    log.warn({ jobId: job.id, jobName: job.name }, "Skipping job — another job is already running");
    return;
  }

  const noop = async () => {};
  runningJob = {
    jobId: job.id,
    jobName: job.name,
    session: { abort: noop, destroy: noop },
    responseBuffer: "",
    cancelled: false,
  };

  const runId = createJobRun(job.id);
  const startTime = Date.now();
  let session: {
    destroy(): Promise<void>;
    sendAndWait: Function;
    on: Function;
    abort(): Promise<void>;
  } | null = null;
  let responseBuffer = "";

  try {
    const client = getClient();
    if (!client) throw new Error("Copilot client not started");

    const systemContext = await buildSystemContext();
    const jobPreamble = `You are executing a scheduled job named "${job.name}". Produce a concise, useful response to the following prompt. Do not ask follow-up questions — just execute the task.`;

    session = await client.createSession({
      clientName: "neo-job",
      model: config.copilot.model,
      systemMessage: {
        mode: "replace" as const,
        content: `${systemContext}\n\n${jobPreamble}`,
      },
      tools: allTools,
      onPermissionRequest: approveAll,
      hooks: {
        onPreToolUse: preToolUse(String(config.telegram.ownerId)),
      },
      workingDirectory: config.paths.root,
    });

    runningJob.session = session;

    const unsubscribe = session.on((event: SessionEvent) => {
      if (event.type === "assistant.message") {
        const content = (event.data as { content?: string }).content;
        if (content) {
          responseBuffer = content;
          if (runningJob) runningJob.responseBuffer = content;
        }
      }
    });

    try {
      const result = await session.sendAndWait({ prompt: job.prompt });
      const finalContent =
        (result as { data?: { content?: string } })?.data?.content ?? responseBuffer;

      const durationMs = Date.now() - startTime;
      completeJobRun(runId, finalContent || "(no output)", durationMs);

      const header = `📋 Job "${job.name}" completed (${Math.round(durationMs / 1000)}s):`;
      const output = finalContent || "(no output)";
      const chunks = splitMessage(`${header}\n\n${output}`);
      for (const chunk of chunks) {
        try {
          await notifyText(target, chunk);
        } catch (err) {
          log.error({ err, jobId: job.id }, "Failed to send job output");
        }
      }

      unsubscribe();
    } catch (err) {
      unsubscribe();

      const durationMs = Date.now() - startTime;
      if (runningJob?.cancelled && responseBuffer) {
        completeJobRun(runId, `(cancelled — partial output)\n\n${responseBuffer}`, durationMs);
        const header = `📋 Job "${job.name}" cancelled (${Math.round(durationMs / 1000)}s, partial output):`;
        const chunks = splitMessage(`${header}\n\n${responseBuffer}`);
        for (const chunk of chunks) {
          try {
            await notifyText(target, chunk);
          } catch (sendErr) {
            log.error({ err: sendErr, jobId: job.id }, "Failed to send job output");
          }
        }
      } else {
        throw err;
      }
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    failJobRun(runId, errorMsg, durationMs);

    log.error({ err, jobId: job.id, jobName: job.name }, "Job execution failed");

    try {
      await notifyText(target, `⚠️ Job "${job.name}" failed: ${errorMsg}`);
    } catch (sendErr) {
      log.error({ err: sendErr, jobId: job.id }, "Failed to send job error notification");
    }
  } finally {
    if (session) {
      try {
        await session.destroy();
      } catch {
        // ignore
      }
    }
    runningJob = null;
  }
}
