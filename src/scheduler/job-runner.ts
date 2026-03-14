import type { Api } from "grammy";
import type { SessionEvent } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import { getClient } from "../agent.js";
import { config } from "../config.js";
import { allTools } from "../tools/index.js";
import { buildSystemContext } from "../memory/index.js";
import { getLogger } from "../logging/index.js";
import { splitMessage } from "../telegram/messages.js";
import { createJobRun, completeJobRun, failJobRun } from "./jobs-db.js";
import type { Job } from "./jobs-db.js";

const JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

let running = false;

export async function executeJob(job: Job, api: Api): Promise<void> {
  const log = getLogger();

  if (running) {
    log.warn({ jobId: job.id, jobName: job.name }, "Skipping job — another job is already running");
    return;
  }

  running = true;
  const runId = createJobRun(job.id);
  const startTime = Date.now();
  let session: { destroy(): Promise<void>; sendAndWait: Function; on: Function } | null = null;

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
      workingDirectory: config.paths.root,
    });

    let responseBuffer = "";

    const unsubscribe = session.on((event: SessionEvent) => {
      if (event.type === "assistant.message") {
        const content = (event.data as { content?: string }).content;
        if (content) responseBuffer = content;
      }
    });

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(async () => {
        if (session) {
          try {
            await session.destroy();
          } catch {
            // ignore cleanup failure during timeout handling
          }
        }
        reject(new Error("Job timed out after 5 minutes"));
      }, JOB_TIMEOUT_MS);
    });

    try {
      const result = await Promise.race([
        session.sendAndWait({ prompt: job.prompt }),
        timeoutPromise,
      ]);
      const finalContent =
        (result as { data?: { content?: string } })?.data?.content ?? responseBuffer;

      const durationMs = Date.now() - startTime;
      completeJobRun(runId, finalContent || "(no output)", durationMs);

      // Notify owner
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

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      unsubscribe();
    } catch (err) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      unsubscribe();
      throw err;
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
    running = false;
  }
}
