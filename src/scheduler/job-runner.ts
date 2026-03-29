import type { Api } from "grammy";
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
import {
  isJobRunning,
  getRunningJob,
  setRunningJob,
  setRunningJobSession,
  setRunningJobResponse,
  isRunningJobCancelled,
  clearRunningJob,
  cancelRunningJob,
} from "./job-state";

export { isJobRunning, getRunningJob, cancelRunningJob };

export async function executeJob(job: Job, api: Api): Promise<void> {
  const log = getLogger();

  if (isJobRunning()) {
    log.warn({ jobId: job.id, jobName: job.name }, "Skipping job — another job is already running");
    return;
  }

  // Mark as running before session creation so isJobRunning() is true
  // when hooks fire during createSession. Session ref is set after.
  const noop = async () => {};
  setRunningJob({
    jobId: job.id,
    jobName: job.name,
    session: { abort: noop, destroy: noop },
    responseBuffer: "",
    cancelled: false,
  });

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
        onPreToolUse: preToolUse(config.telegram.ownerId, config.service.systemdUnit),
      },
      workingDirectory: config.paths.root,
    });

    setRunningJobSession(session);

    const unsubscribe = session.on((event: SessionEvent) => {
      if (event.type === "assistant.message") {
        const content = (event.data as { content?: string }).content;
        if (content) {
          responseBuffer = content;
          setRunningJobResponse(content);
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
          await api.sendMessage(config.telegram.ownerId, chunk);
        } catch (err) {
          log.error({ err, jobId: job.id }, "Failed to send job output");
        }
      }

      unsubscribe();
    } catch (err) {
      unsubscribe();

      // Preserve partial results only on explicit cancellation
      const durationMs = Date.now() - startTime;
      if (isRunningJobCancelled() && responseBuffer) {
        completeJobRun(runId, `(cancelled — partial output)\n\n${responseBuffer}`, durationMs);
        const header = `📋 Job "${job.name}" cancelled (${Math.round(durationMs / 1000)}s, partial output):`;
        const chunks = splitMessage(`${header}\n\n${responseBuffer}`);
        for (const chunk of chunks) {
          try {
            await api.sendMessage(config.telegram.ownerId, chunk);
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
      await api.sendMessage(config.telegram.ownerId, `⚠️ Job "${job.name}" failed: ${errorMsg}`);
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
    clearRunningJob();
  }
}
