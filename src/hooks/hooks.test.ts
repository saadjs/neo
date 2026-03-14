import { describe, expect, it, vi, beforeEach } from "vitest";

const { cancelPendingUserInputForSessionMock } = vi.hoisted(() => ({
  cancelPendingUserInputForSessionMock: vi.fn(),
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

import { preToolUse } from "./pre-tool.js";
import { postToolUse } from "./post-tool.js";
import { errorOccurred } from "./error.js";
import { sessionEnd } from "./session-lifecycle.js";
import { isJobRunning } from "../scheduler/job-runner.js";
import { consumeSessionErrorNotified } from "./error-state.js";

const CHAT_ID = -100123;
const INVOCATION = { sessionId: "test-session" };

function baseInput(overrides: Record<string, unknown> = {}): any {
  return { timestamp: Date.now(), cwd: "/tmp", ...overrides };
}

describe("preToolUse", () => {
  const handler = preToolUse(CHAT_ID);

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

  beforeEach(() => {
    consumeSessionErrorNotified(INVOCATION.sessionId);
  });

  it("retries recoverable model_call errors", async () => {
    const result = await handler(
      baseInput({ error: "timeout", errorContext: "model_call", recoverable: true }),
      INVOCATION,
    );

    expect(result).toEqual({ errorHandling: "retry", retryCount: 2 });
  });

  it("does not retry non-recoverable model_call errors", async () => {
    const result = await handler(
      baseInput({ error: "fatal", errorContext: "model_call", recoverable: false }),
      INVOCATION,
    );

    expect(result).toEqual({
      errorHandling: "abort",
      userNotification: expect.stringContaining("fatal"),
    });
    expect(consumeSessionErrorNotified(INVOCATION.sessionId)).toBe(true);
  });

  it("does not notify user for tool_execution errors", async () => {
    const result = await handler(
      baseInput({ error: "tool broke", errorContext: "tool_execution", recoverable: false }),
      INVOCATION,
    );

    expect(result).toBeUndefined();
    expect(consumeSessionErrorNotified(INVOCATION.sessionId)).toBe(false);
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
