import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("vscode-jsonrpc/node", () => ({
  StreamMessageReader: class {},
  StreamMessageWriter: class {},
  MessageConnection: { listen: () => ({}) },
}));

vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: class {},
}));

const { cancelPendingUserInputForSessionMock, setActiveSessionMock, logSessionMock } = vi.hoisted(
  () => ({
    cancelPendingUserInputForSessionMock: vi.fn(),
    setActiveSessionMock: vi.fn(),
    logSessionMock: vi.fn(),
  }),
);

vi.mock("../agent.js", () => ({
  getModelForChat: vi.fn(() => "gpt-4.1"),
}));

vi.mock("../commands/model-catalog.js", () => ({
  getNextFallbackModel: vi.fn().mockResolvedValue(null),
}));

vi.mock("../logging/index.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../scheduler/job-runner.js", () => ({
  isJobRunning: vi.fn(),
}));

vi.mock("../telegram/user-input.js", () => ({
  cancelPendingUserInputForSession: cancelPendingUserInputForSessionMock,
}));

vi.mock("../logging/conversations.js", () => ({
  setActiveSession: setActiveSessionMock,
  logSession: logSessionMock,
}));

vi.mock("../memory/daily.js", () => ({
  readDailyMemory: vi.fn().mockResolvedValue(""),
  isChannelChat: vi.fn().mockReturnValue(false),
}));

vi.mock("../runtime/state.js", () => ({
  getRuntimeContextSection: vi.fn().mockReturnValue(""),
}));

vi.mock("../logging/anomalies.js", () => ({
  formatAnomaliesForContext: vi.fn().mockReturnValue(""),
}));

import { preToolUse } from "./pre-tool";
import { postToolUse } from "./post-tool";
import { errorOccurred, resetModelCallFailures } from "./error";
import { sessionEnd } from "./session-lifecycle";
import { sessionStart } from "./session-start";
import { isJobRunning } from "../scheduler/job-runner";
import { readDailyMemory, isChannelChat } from "../memory/daily";
import { getRuntimeContextSection } from "../runtime/state";
import { formatAnomaliesForContext } from "../logging/anomalies";

const CHAT_ID = -100123;
const INVOCATION = { sessionId: "test-session" };

function baseInput(overrides: Record<string, unknown> = {}): any {
  return { timestamp: Date.now(), cwd: "/tmp", ...overrides };
}

describe("preToolUse", () => {
  const handler = preToolUse(CHAT_ID, "neo");

  beforeEach(() => {
    vi.mocked(isJobRunning).mockReturnValue(false);
  });

  it("denies system.restart_service when a job is running", () => {
    vi.mocked(isJobRunning).mockReturnValue(true);

    const result = handler(
      baseInput({ toolName: "system", toolArgs: { action: "restart_service" } }),
      INVOCATION,
    );

    expect(result).toEqual({
      permissionDecision: "deny",
      permissionDecisionReason: expect.stringContaining("scheduled job"),
    });
  });

  it("allows system.restart_service when no job is running", () => {
    const result = handler(
      baseInput({ toolName: "system", toolArgs: { action: "restart_service" } }),
      INVOCATION,
    );

    expect(result).toBeUndefined();
  });

  it("allows other system actions regardless of job state", () => {
    vi.mocked(isJobRunning).mockReturnValue(true);

    const result = handler(
      baseInput({ toolName: "system", toolArgs: { action: "status" } }),
      INVOCATION,
    );

    expect(result).toBeUndefined();
  });

  it("allows non-system tools", () => {
    const result = handler(
      baseInput({ toolName: "browser", toolArgs: { action: "navigate" } }),
      INVOCATION,
    );

    expect(result).toBeUndefined();
  });
});

describe("postToolUse", () => {
  const handler = postToolUse(CHAT_ID);

  it("returns nothing for non-browser tools", () => {
    const result = handler(
      baseInput({
        toolName: "memory",
        toolArgs: { operation: "read", target: "soul" },
        toolResult: { textResultForLlm: "ok", resultType: "success" },
      }),
      INVOCATION,
    );

    expect(result).toBeUndefined();
  });
});

describe("errorOccurred", () => {
  const handler = errorOccurred(CHAT_ID);

  it("retries transient model_call errors", async () => {
    const invocation = { sessionId: "test-retry-transient" };
    const result = await handler(
      baseInput({ error: new Error("timeout"), errorContext: "model_call", recoverable: true }),
      invocation,
    );

    expect(result).toEqual({ errorHandling: "retry" });
  });

  it("aborts immediately for opaque model_call errors", async () => {
    const invocation = { sessionId: "test-opaque" };
    const result = await handler(
      baseInput({ error: {}, errorContext: "model_call", recoverable: true }),
      invocation,
    );

    expect(result).toEqual({ errorHandling: "abort" });
  });

  it("aborts after repeated transient model_call failures", async () => {
    const invocation = { sessionId: "test-retry-exhaust" };
    // First two calls retry
    await handler(
      baseInput({ error: new Error("timeout"), errorContext: "model_call", recoverable: true }),
      invocation,
    );
    await handler(
      baseInput({ error: new Error("timeout"), errorContext: "model_call", recoverable: true }),
      invocation,
    );

    // Third call should abort
    const result = await handler(
      baseInput({ error: new Error("timeout"), errorContext: "model_call", recoverable: true }),
      invocation,
    );

    expect(result).toEqual({ errorHandling: "abort" });
  });

  it("allows a fresh retry episode after the counter is reset", async () => {
    const invocation = { sessionId: "test-retry-reset" };

    await handler(
      baseInput({ error: new Error("timeout"), errorContext: "model_call", recoverable: true }),
      invocation,
    );
    await handler(
      baseInput({ error: new Error("timeout"), errorContext: "model_call", recoverable: true }),
      invocation,
    );

    resetModelCallFailures(invocation.sessionId);

    const result = await handler(
      baseInput({ error: new Error("timeout"), errorContext: "model_call", recoverable: true }),
      invocation,
    );

    expect(result).toEqual({ errorHandling: "retry" });
  });

  it("does not retry non-recoverable model_call errors", async () => {
    const result = await handler(
      baseInput({ error: "fatal", errorContext: "model_call", recoverable: false }),
      INVOCATION,
    );

    expect(result).toEqual({ errorHandling: "abort" });
  });

  it("does not notify user for tool_execution errors", async () => {
    const result = await handler(
      baseInput({ error: "tool broke", errorContext: "tool_execution", recoverable: false }),
      INVOCATION,
    );

    expect(result).toBeUndefined();
  });
});

describe("sessionEnd", () => {
  const handler = sessionEnd(CHAT_ID);

  beforeEach(() => {
    cancelPendingUserInputForSessionMock.mockReset();
  });

  it("returns nothing for completed sessions", async () => {
    const result = await handler(
      baseInput({ reason: "complete", finalMessage: "All done" }),
      INVOCATION,
    );

    expect(result).toBeUndefined();
  });

  it("cancels pending user input for errored sessions", async () => {
    const result = await handler(
      baseInput({ reason: "error", error: "something broke" }),
      INVOCATION,
    );

    expect(result).toBeUndefined();
    expect(cancelPendingUserInputForSessionMock).toHaveBeenCalledWith(
      CHAT_ID,
      INVOCATION.sessionId,
      "The pending question was cancelled because the session ended.",
    );
  });
});

describe("sessionStart", () => {
  const getModel = () => "claude-sonnet-4";
  const handler = sessionStart(CHAT_ID, getModel);

  beforeEach(() => {
    setActiveSessionMock.mockReset();
    logSessionMock.mockReset();
    vi.mocked(readDailyMemory).mockResolvedValue("");
    vi.mocked(isChannelChat).mockReturnValue(false);
    vi.mocked(getRuntimeContextSection).mockReturnValue("");
    vi.mocked(formatAnomaliesForContext).mockReturnValue("");
  });

  it("calls setActiveSession for all source types", async () => {
    for (const source of ["new", "resume", "startup"] as const) {
      setActiveSessionMock.mockReset();
      await handler(baseInput({ source }), INVOCATION);
      expect(setActiveSessionMock).toHaveBeenCalledWith(CHAT_ID, INVOCATION.sessionId);
    }
  });

  it("logs session entry only for new sessions", async () => {
    await handler(baseInput({ source: "new" }), INVOCATION);
    expect(logSessionMock).toHaveBeenCalledWith(INVOCATION.sessionId, CHAT_ID, "claude-sonnet-4");

    logSessionMock.mockReset();
    await handler(baseInput({ source: "resume" }), INVOCATION);
    expect(logSessionMock).not.toHaveBeenCalled();

    await handler(baseInput({ source: "startup" }), INVOCATION);
    expect(logSessionMock).not.toHaveBeenCalled();
  });

  it("returns additionalContext with today's memory", async () => {
    vi.mocked(readDailyMemory).mockResolvedValue("remembered something");

    const result = await handler(baseInput({ source: "new" }), INVOCATION);

    expect(result?.additionalContext).toContain("Today's Memory");
    expect(result?.additionalContext).toContain("remembered something");
  });

  it("returns additionalContext with runtime context and anomalies", async () => {
    vi.mocked(getRuntimeContextSection).mockReturnValue("## Runtime\n\njob running");
    vi.mocked(formatAnomaliesForContext).mockReturnValue("## Anomalies\n\n3 failures");

    const result = await handler(baseInput({ source: "new" }), INVOCATION);

    expect(result?.additionalContext).toContain("job running");
    expect(result?.additionalContext).toContain("3 failures");
  });

  it("includes channel memory for channel chats", async () => {
    vi.mocked(isChannelChat).mockReturnValue(true);
    vi.mocked(readDailyMemory)
      .mockResolvedValueOnce("global memory")
      .mockResolvedValueOnce("channel memory");

    const result = await handler(baseInput({ source: "new" }), INVOCATION);

    expect(result?.additionalContext).toContain("Channel Memory (Today)");
    expect(result?.additionalContext).toContain("channel memory");
  });

  it("returns void when no dynamic context available", async () => {
    const result = await handler(baseInput({ source: "new" }), INVOCATION);

    expect(result).toBeUndefined();
  });

  it("returns void gracefully when dynamic context build fails", async () => {
    vi.mocked(readDailyMemory).mockRejectedValue(new Error("disk error"));

    const result = await handler(baseInput({ source: "new" }), INVOCATION);

    expect(result).toBeUndefined();
  });

  it("does not throw if setActiveSession fails", async () => {
    setActiveSessionMock.mockImplementation(() => {
      throw new Error("db locked");
    });

    await expect(handler(baseInput({ source: "new" }), INVOCATION)).resolves.not.toThrow();
  });
});
