import { afterEach, describe, expect, it, vi } from "vitest";

const {
  createSessionMock,
  sendAndWaitMock,
  sessionOnMock,
  sessionDestroyMock,
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
        sendAndWait: sendAndWaitMock,
      };
    });

    const { executeJob } = await import("./job-runner.js");

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
});
