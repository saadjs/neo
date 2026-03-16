import { afterEach, describe, expect, it, vi } from "vitest";

const {
  listJobsMock,
  getJobRunsMock,
  setJobEnabledMock,
  deleteJobMock,
  cancelRunningJobMock,
  getRunningJobMock,
} = vi.hoisted(() => ({
  listJobsMock: vi.fn(),
  getJobRunsMock: vi.fn(),
  setJobEnabledMock: vi.fn(),
  deleteJobMock: vi.fn(),
  cancelRunningJobMock: vi.fn(),
  getRunningJobMock: vi.fn(),
}));

vi.mock("../scheduler/jobs-db.js", () => ({
  listJobs: listJobsMock,
  getJobRuns: getJobRunsMock,
  setJobEnabled: setJobEnabledMock,
  deleteJob: deleteJobMock,
}));

vi.mock("../scheduler/job-runner.js", () => ({
  getRunningJob: getRunningJobMock,
  cancelRunningJob: cancelRunningJobMock,
}));

vi.mock("../scheduler/cron.js", () => ({
  describeCron: (expr: string) => expr,
}));

vi.mock("../logging/index.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));

import { handleJobs, handleJobsCallback, isJobsCallback } from "./jobs.js";

afterEach(() => {
  listJobsMock.mockReset();
  getJobRunsMock.mockReset();
  setJobEnabledMock.mockReset();
  deleteJobMock.mockReset();
  cancelRunningJobMock.mockReset();
  getRunningJobMock.mockReset();
});

function makeCtx(text = "/jobs") {
  return {
    message: { text },
    chat: { id: 42 },
    reply: vi.fn(),
    callbackQuery: undefined as unknown,
    answerCallbackQuery: vi.fn(),
    api: { editMessageText: vi.fn() },
  } as unknown as Parameters<typeof handleJobs>[0];
}

function makeCallbackCtx(data: string) {
  return {
    chat: { id: 42 },
    callbackQuery: {
      data,
      message: { message_id: 100 },
    },
    reply: vi.fn(),
    answerCallbackQuery: vi.fn(),
    api: { editMessageText: vi.fn() },
  } as unknown as Parameters<typeof handleJobsCallback>[0];
}

describe("isJobsCallback", () => {
  it("matches job: prefixed data", () => {
    expect(isJobsCallback("job:toggle:abc:1")).toBe(true);
    expect(isJobsCallback("session:resume:abc:1")).toBe(false);
    expect(isJobsCallback(undefined)).toBe(false);
  });
});

describe("handleJobs", () => {
  it("shows empty message when no jobs exist", async () => {
    listJobsMock.mockReturnValue([]);
    getRunningJobMock.mockReturnValue(null);
    const ctx = makeCtx();

    await handleJobs(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("No scheduled jobs.", { reply_markup: undefined });
  });

  it("lists jobs with correct status indicators", async () => {
    listJobsMock.mockReturnValue([
      {
        id: 1,
        name: "code-review",
        cron_expression: "0 0 * * *",
        enabled: 1,
        next_run_at: "2026-03-17T00:00:00.000Z",
      },
      {
        id: 2,
        name: "cleanup",
        cron_expression: "0 3 * * 0",
        enabled: 0,
        next_run_at: "2026-03-22T03:00:00.000Z",
      },
    ]);
    getRunningJobMock.mockReturnValue(null);
    const ctx = makeCtx();

    await handleJobs(ctx);

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain("📋 Jobs (2 total)");
    expect(text).toContain("▶️ code-review");
    expect(text).toContain("enabled");
    expect(text).toContain("⏸ cleanup");
    expect(text).toContain("disabled");
  });

  it("shows running job indicator", async () => {
    listJobsMock.mockReturnValue([
      {
        id: 1,
        name: "code-review",
        cron_expression: "0 0 * * *",
        enabled: 1,
        next_run_at: "2026-03-17T00:00:00.000Z",
      },
    ]);
    getRunningJobMock.mockReturnValue({ jobId: 1, jobName: "code-review" });
    const ctx = makeCtx();

    await handleJobs(ctx);

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain("🔄 Running: code-review");
  });

  it("shows history for a named job via /jobs history <name>", async () => {
    listJobsMock.mockReturnValue([
      {
        id: 1,
        name: "code-review",
        cron_expression: "0 0 * * *",
        enabled: 1,
        next_run_at: "2026-03-17T00:00:00.000Z",
      },
    ]);
    getJobRunsMock.mockReturnValue([
      {
        id: 10,
        job_id: 1,
        status: "completed",
        started_at: "2026-03-16T00:00:00.000Z",
        duration_ms: 5000,
        error: null,
      },
    ]);
    const ctx = makeCtx("/jobs history code-review");

    await handleJobs(ctx);

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain('History for "code-review"');
    expect(text).toContain("✅ completed");
    expect(getJobRunsMock).toHaveBeenCalledWith(1, 5);
  });

  it("replies with error for unknown job name in /jobs history", async () => {
    listJobsMock.mockReturnValue([]);
    const ctx = makeCtx("/jobs history nonexistent");

    await handleJobs(ctx);

    expect(ctx.reply).toHaveBeenCalledWith('No job named "nonexistent".');
  });

  it("cancels a running job via /jobs cancel", async () => {
    cancelRunningJobMock.mockResolvedValue("cancelled");
    const ctx = makeCtx("/jobs cancel");

    await handleJobs(ctx);

    expect(cancelRunningJobMock).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith("Job cancelled.");
  });

  it("reports no job running via /jobs cancel", async () => {
    cancelRunningJobMock.mockResolvedValue("no-job-running");
    const ctx = makeCtx("/jobs cancel");

    await handleJobs(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("No job is currently running.");
  });
});

describe("handleJobsCallback", () => {
  it("toggle callback flips enabled state", async () => {
    const jobs = [
      {
        id: 1,
        name: "test-job",
        cron_expression: "0 0 * * *",
        enabled: 1,
        next_run_at: "2026-03-17T00:00:00.000Z",
      },
    ];
    listJobsMock.mockReturnValue(jobs);
    getRunningJobMock.mockReturnValue(null);
    setJobEnabledMock.mockReturnValue(true);

    // Seed the picker state
    const { handleJobs: handleJobsFresh } = await import("./jobs.js");
    listJobsMock.mockReturnValue(jobs);
    const seedCtx = makeCtx();
    await handleJobsFresh(seedCtx);

    // Extract the pickerId from the reply_markup
    const replyCall = (seedCtx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    const keyboard = replyCall[1]?.reply_markup;
    const buttonData = keyboard?.inline_keyboard?.[0]?.[0]?.callback_data as string;
    const pickerId = buttonData?.split(":")?.[2];

    // Now call with the correct pickerId
    const callbackCtx = makeCallbackCtx(`job:toggle:${pickerId}:1`);
    listJobsMock.mockReturnValue([{ ...jobs[0], enabled: 0 }]);
    await handleJobsCallback(callbackCtx);

    expect(setJobEnabledMock).toHaveBeenCalledWith(1, false);
    expect(callbackCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "test-job disabled",
    });
  });

  it("cancel callback calls cancelRunningJob", async () => {
    const jobs = [
      {
        id: 1,
        name: "test-job",
        cron_expression: "0 0 * * *",
        enabled: 1,
        next_run_at: "2026-03-17T00:00:00.000Z",
      },
    ];
    listJobsMock.mockReturnValue(jobs);
    getRunningJobMock.mockReturnValue({ jobId: 1, jobName: "test-job" });
    cancelRunningJobMock.mockResolvedValue("cancelled");

    // Seed picker and extract pickerId from first button
    const seedCtx = makeCtx();
    await handleJobs(seedCtx);

    const replyCall = (seedCtx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    const keyboard = replyCall[1]?.reply_markup;
    // First button has format job:toggle:<pickerId>:<jobId>
    const firstButtonData = keyboard?.inline_keyboard?.[0]?.[0]?.callback_data as string;
    const pickerId = firstButtonData?.split(":")?.[2];

    const callbackCtx = makeCallbackCtx(`job:cancel:${pickerId}`);
    listJobsMock.mockReturnValue(jobs);
    getRunningJobMock.mockReturnValue(null);
    await handleJobsCallback(callbackCtx);

    expect(cancelRunningJobMock).toHaveBeenCalled();
    expect(callbackCtx.answerCallbackQuery).toHaveBeenCalledWith({ text: "Job cancelled" });
  });

  it("delete callback removes job and refreshes", async () => {
    const jobs = [
      {
        id: 1,
        name: "test-job",
        cron_expression: "0 0 * * *",
        enabled: 1,
        next_run_at: "2026-03-17T00:00:00.000Z",
      },
    ];
    listJobsMock.mockReturnValue(jobs);
    getRunningJobMock.mockReturnValue(null);
    deleteJobMock.mockReturnValue(true);

    // Seed picker
    const seedCtx = makeCtx();
    await handleJobs(seedCtx);

    const replyCall = (seedCtx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    const keyboard = replyCall[1]?.reply_markup;
    // Delete button is the third in first row
    const deleteData = keyboard?.inline_keyboard?.[0]?.[2]?.callback_data as string;
    const pickerId = deleteData?.split(":")?.[2];

    const callbackCtx = makeCallbackCtx(`job:delete:${pickerId}:1`);
    await handleJobsCallback(callbackCtx);

    expect(deleteJobMock).toHaveBeenCalledWith(1);
    expect(callbackCtx.answerCallbackQuery).toHaveBeenCalledWith({ text: "test-job deleted" });
  });

  it("responds with expiry message for unknown picker", async () => {
    const ctx = makeCallbackCtx("job:toggle:unknown:1");
    await handleJobsCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "This picker expired. Send /jobs again.",
    });
  });
});
