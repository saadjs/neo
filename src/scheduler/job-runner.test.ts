import { afterEach, describe, expect, it, vi } from "vitest";

const {
  createSessionMock,
  sendAndWaitMock,
  sessionOnMock,
  sessionDestroyMock,
  sessionAbortMock,
  buildSystemContextMock,
  createJobRunMock,
  completeJobRunMock,
  failJobRunMock,
  approveAllMock,
} = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  sendAndWaitMock: vi.fn(),
  sessionOnMock: vi.fn(),
  sessionDestroyMock: vi.fn(),
  sessionAbortMock: vi.fn(),
  buildSystemContextMock: vi.fn(),
  createJobRunMock: vi.fn(),
  completeJobRunMock: vi.fn(),
  failJobRunMock: vi.fn(),
  approveAllMock: vi.fn(),
}));

vi.mock("@github/copilot-sdk", () => ({
  approveAll: approveAllMock,
}));

vi.mock("../agent.js", () => ({
  getClient: () => ({
    createSession: createSessionMock,
  }),
}));

vi.mock("../config.js", () => ({
  config: {
    copilot: { model: "gpt-4.1" },
    paths: { root: "/tmp/neo" },
    telegram: { ownerId: 123 },
  },
}));

vi.mock("../tools/index.js", () => ({
  allTools: [],
}));

vi.mock("../memory/index.js", () => ({
  buildSystemContext: buildSystemContextMock,
}));

vi.mock("../logging/index.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("./jobs-db.js", () => ({
  createJobRun: createJobRunMock,
  completeJobRun: completeJobRunMock,
  failJobRun: failJobRunMock,
}));

vi.mock("../telegram/messages.js", () => ({
  splitMessage: (text: string) => [text],
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("executeJob", () => {
  it("attaches the restart guard hook to scheduled-job sessions", async () => {
    let preToolDecision: unknown;

    buildSystemContextMock.mockResolvedValue("context");
    createJobRunMock.mockReturnValue(1);
    sendAndWaitMock.mockResolvedValue({ data: { content: "done" } });
    sessionOnMock.mockReturnValue(() => {});
    sessionDestroyMock.mockResolvedValue(undefined);
    createSessionMock.mockImplementation(async (sessionConfig) => {
      preToolDecision = sessionConfig.hooks?.onPreToolUse?.(
        {
          timestamp: Date.now(),
          cwd: "/tmp/neo",
          toolName: "system",
          toolArgs: { action: "restart_service" },
        },
        { sessionId: "job-session" },
      );

      return {
        on: sessionOnMock,
        destroy: sessionDestroyMock,
        abort: sessionAbortMock,
        sendAndWait: sendAndWaitMock,
      };
    });

    const { executeJob } = await import("./job-runner");

    await executeJob(
      {
        id: 7,
        name: "nightly",
        prompt: "restart if needed",
        cron_expression: "0 0 * * *",
        enabled: 1,
        created_at: "2026-03-13T00:00:00.000Z",
        updated_at: "2026-03-13T00:00:00.000Z",
        next_run_at: "2026-03-14T00:00:00.000Z",
      },
      { sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const sessionConfig = createSessionMock.mock.calls[0]?.[0];
    expect(sessionConfig.hooks?.onPreToolUse).toBeTypeOf("function");

    expect(preToolDecision).toEqual({
      permissionDecision: "deny",
      permissionDecisionReason: expect.stringContaining("scheduled job"),
    });
    expect(failJobRunMock).not.toHaveBeenCalled();
  });

  it("runs job to completion without a timeout", async () => {
    buildSystemContextMock.mockResolvedValue("context");
    createJobRunMock.mockReturnValue(1);
    sendAndWaitMock.mockResolvedValue({ data: { content: "result" } });
    sessionOnMock.mockReturnValue(() => {});
    sessionDestroyMock.mockResolvedValue(undefined);
    sessionAbortMock.mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue({
      on: sessionOnMock,
      destroy: sessionDestroyMock,
      abort: sessionAbortMock,
      sendAndWait: sendAndWaitMock,
    });

    const { executeJob } = await import("./job-runner");
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await executeJob(
      {
        id: 1,
        name: "test-job",
        prompt: "do something",
        cron_expression: "0 0 * * *",
        enabled: 1,
        created_at: "2026-03-13T00:00:00.000Z",
        updated_at: "2026-03-13T00:00:00.000Z",
        next_run_at: "2026-03-14T00:00:00.000Z",
      },
      { sendMessage } as never,
    );

    expect(completeJobRunMock).toHaveBeenCalledWith(1, "result", expect.any(Number));
    expect(failJobRunMock).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();
  });

  it("exposes running job metadata and cancels via abort", async () => {
    buildSystemContextMock.mockResolvedValue("context");
    createJobRunMock.mockReturnValue(2);
    sessionOnMock.mockReturnValue(() => {});
    sessionDestroyMock.mockResolvedValue(undefined);
    sessionAbortMock.mockResolvedValue(undefined);

    // sendAndWait blocks until we resolve it externally
    let resolveSendAndWait!: (v: unknown) => void;
    sendAndWaitMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSendAndWait = resolve;
      }),
    );
    createSessionMock.mockResolvedValue({
      on: sessionOnMock,
      destroy: sessionDestroyMock,
      abort: sessionAbortMock,
      sendAndWait: sendAndWaitMock,
    });

    const { executeJob, getRunningJob, cancelRunningJob } = await import("./job-runner");

    expect(getRunningJob()).toBeNull();

    const jobPromise = executeJob(
      {
        id: 3,
        name: "long-job",
        prompt: "complex task",
        cron_expression: "0 0 * * *",
        enabled: 1,
        created_at: "2026-03-13T00:00:00.000Z",
        updated_at: "2026-03-13T00:00:00.000Z",
        next_run_at: "2026-03-14T00:00:00.000Z",
      },
      { sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
    );

    // Wait until sendAndWait is called — by then the real session is assigned
    await vi.waitFor(() => expect(sendAndWaitMock).toHaveBeenCalled());

    expect(getRunningJob()).toEqual({ jobId: 3, jobName: "long-job" });

    const status = await cancelRunningJob();
    expect(status).toBe("cancelled");
    expect(sessionAbortMock).toHaveBeenCalled();

    // Resolve sendAndWait so the job completes
    resolveSendAndWait({ data: { content: "partial" } });
    await jobPromise;

    expect(getRunningJob()).toBeNull();
  });

  it("returns no-job-running when cancelling with nothing running", async () => {
    const { cancelRunningJob } = await import("./job-runner");
    const status = await cancelRunningJob();
    expect(status).toBe("no-job-running");
  });
});
