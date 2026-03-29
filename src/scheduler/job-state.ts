import { getLogger } from "../logging/index";

interface RunningJobState {
  jobId: number;
  jobName: string;
  session: { abort(): Promise<void>; destroy(): Promise<void> };
  responseBuffer: string;
  cancelled: boolean;
}

let runningJob: RunningJobState | null = null;

export function isJobRunning(): boolean {
  return runningJob !== null;
}

export function getRunningJob(): { jobId: number; jobName: string } | null {
  if (!runningJob) return null;
  return { jobId: runningJob.jobId, jobName: runningJob.jobName };
}

export function setRunningJob(state: RunningJobState): void {
  runningJob = state;
}

export function setRunningJobSession(session: RunningJobState["session"]): void {
  if (runningJob) runningJob.session = session;
}

export function setRunningJobResponse(content: string): void {
  if (runningJob) runningJob.responseBuffer = content;
}

export function isRunningJobCancelled(): boolean {
  return runningJob?.cancelled ?? false;
}

export function clearRunningJob(): void {
  runningJob = null;
}

export async function cancelRunningJob(): Promise<"cancelled" | "no-job-running"> {
  if (!runningJob) return "no-job-running";
  const log = getLogger();
  log.info({ jobId: runningJob.jobId, jobName: runningJob.jobName }, "Cancelling running job");
  runningJob.cancelled = true;
  await runningJob.session.abort();
  return "cancelled";
}
