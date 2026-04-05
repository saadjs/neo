/* eslint-disable vitest/require-mock-type-parameters */
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock vscode-jsonrpc and Copilot SDK before other imports to prevent ESM resolution issues
vi.mock("vscode-jsonrpc/node", () => ({
  StreamMessageReader: class {},
  StreamMessageWriter: class {},
  MessageConnection: { listen: () => ({}) },
}));

vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: class {},
  defineTool: () => ({}),
}));

const {
  botHandlers,
  resolvePendingUserInputMock,
  getPendingUserInputMock,
  registerCommandsMock,
  resetModelCallFailuresMock,
  getModelReasoningInfoMock,
  watchPendingUserInputMock,
  getChannelConfigMock,
  upsertChannelConfigMock,
} = vi.hoisted(() => ({
  botHandlers: new Map<string, (ctx: unknown) => Promise<void>>(),
  resolvePendingUserInputMock: vi.fn(),
  getPendingUserInputMock: vi.fn(),
  registerCommandsMock: vi.fn(async () => {}),
  resetModelCallFailuresMock: vi.fn(),
  getModelReasoningInfoMock: vi.fn(),
  watchPendingUserInputMock: vi.fn(() => () => {}),
  getChannelConfigMock: vi.fn(() => null),
  upsertChannelConfigMock: vi.fn(),
}));

vi.mock("grammy", () => ({
  Bot: class MockBot {
    use = vi.fn();
    on = vi.fn((event: string, handler: (ctx: unknown) => Promise<void>) => {
      botHandlers.set(event, handler);
      return this;
    });
    catch = vi.fn();
  },
}));

vi.mock("@grammyjs/runner", () => ({
  run: vi.fn(() => ({
    stop: vi.fn(),
    task: vi.fn(() => Promise.resolve()),
    isRunning: vi.fn(() => true),
  })),
}));

vi.mock("./config.js", () => ({
  config: {
    telegram: {
      botToken: "token",
      ownerId: 1,
    },
    paths: {
      data: "/tmp",
      logs: "/tmp",
    },
  },
}));

vi.mock("./agent.js", () => ({
  beginSessionTurn: vi.fn(),
  clearReasoningEffort: vi.fn(),
  consumeAbortFlag: vi.fn(() => false),
  discardSession: vi.fn(),
  endSessionTurn: vi.fn(),
  getClient: vi.fn(),
  getModelForChat: vi.fn(),
  getOrCreateSession: vi.fn(),
  getPerChatReasoningEffortOverride: vi.fn(() => undefined),
  getReasoningEffortForChat: vi.fn(() => undefined),
  hasTrackedSession: vi.fn(),
  refreshSessionContext: vi.fn(),
  switchModel: vi.fn(),
}));

vi.mock("./logging/index.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("./logging/conversations.js", () => ({
  logMessage: vi.fn(),
  logToolCall: vi.fn(),
  completeToolCall: vi.fn(),
  getLastCompactionEventId: vi.fn(),
  setLastCompactionEventId: vi.fn(),
  setSessionTags: vi.fn(),
}));

vi.mock("./commands/index.js", () => ({
  registerCommands: registerCommandsMock,
}));

vi.mock("./commands/model.js", () => ({
  handleModelCallback: vi.fn(),
  isModelCallback: vi.fn(() => false),
}));

vi.mock("./commands/model-catalog.js", () => ({
  getModelReasoningInfo: getModelReasoningInfoMock,
}));

vi.mock("./commands/reasoning.js", () => ({
  handleReasoningCallback: vi.fn(),
  isReasoningCallback: vi.fn(() => false),
}));

vi.mock("./commands/session.js", () => ({
  handleSessionCallback: vi.fn(),
  isSessionCallback: vi.fn(() => false),
}));

vi.mock("./commands/jobs.js", () => ({
  handleJobsCallback: vi.fn(),
  isJobsCallback: vi.fn(() => false),
}));

vi.mock("./telegram/files.js", () => ({
  downloadTelegramFile: vi.fn(),
}));

vi.mock("./telegram/messages.js", () => ({
  splitMessage: vi.fn((text: string) => [text]),
}));

vi.mock("./memory/index.js", () => ({
  appendCompactionMemory: vi.fn(),
}));

vi.mock("./memory/db.js", () => ({
  getChannelConfig: getChannelConfigMock,
  upsertChannelConfig: upsertChannelConfigMock,
}));

vi.mock("./logging/cost.js", () => ({
  recordCompactionTokens: vi.fn(),
  recordMessageEstimate: vi.fn(),
}));

vi.mock("./memory/tagging.js", () => ({
  extractTags: vi.fn(() => []),
}));

vi.mock("./voice/transcribe.js", () => ({
  isVoiceEnabled: vi.fn(() => false),
  transcribeFile: vi.fn(),
}));

vi.mock("./telegram/progress.js", () => ({
  TYPING_REFRESH_MS: 1000,
  PROGRESS_REFRESH_MS: 1000,
  PROGRESS_EDIT_DEBOUNCE_MS: 100,
  formatProgressName: vi.fn((name?: string) => name ?? "tool"),
  buildProgressText: vi.fn(() => "Thinking..."),
}));

vi.mock("./telegram/session-timeout.js", () => ({
  isMessageNotModifiedError: vi.fn(() => false),
  isMissingProgressMessageError: vi.fn(() => false),
}));

vi.mock("./telegram/user-input.js", () => ({
  cancelPendingUserInputForSession: vi.fn(),
  getPendingUserInput: getPendingUserInputMock,
  resolvePendingUserInput: resolvePendingUserInputMock,
  watchPendingUserInput: watchPendingUserInputMock,
}));

vi.mock("./telegram/session-errors.js", () => ({
  shouldSilenceSessionError: vi.fn(() => false),
}));

vi.mock("./hooks/error-state.js", () => ({
  clearFallbackAttemptState: vi.fn(),
  consumePendingFailover: vi.fn(() => null),
  consumeSessionErrorNotified: vi.fn(() => false),
  consumeSessionErrorSummary: vi.fn(() => null),
  markFallbackModelAttempted: vi.fn(),
}));

vi.mock("./hooks/error.js", () => ({
  resetModelCallFailures: resetModelCallFailuresMock,
}));

afterEach(() => {
  botHandlers.clear();
  resolvePendingUserInputMock.mockReset();
  getPendingUserInputMock.mockReset();
  registerCommandsMock.mockClear();
  resetModelCallFailuresMock.mockReset();
  getModelReasoningInfoMock.mockReset();
  getModelReasoningInfoMock.mockResolvedValue(null);
  watchPendingUserInputMock.mockReset();
  watchPendingUserInputMock.mockImplementation(() => () => {});
  getChannelConfigMock.mockReset();
  getChannelConfigMock.mockReturnValue(null);
  upsertChannelConfigMock.mockReset();
  vi.resetModules();
});

describe("createBot", () => {
  it("accepts slash-prefixed replies while user input is pending", async () => {
    const { createBot } = await import("./bot");
    await createBot();

    const textHandler = botHandlers.get("message:text");
    expect(textHandler).toBeTypeOf("function");

    getPendingUserInputMock.mockReturnValue({
      chatId: 123,
      sessionId: "session-1",
    });
    resolvePendingUserInputMock.mockReturnValue({
      answer: "/tmp/file",
      wasFreeform: true,
    });

    const reply = vi.fn();
    const replyWithChatAction = vi.fn();

    await textHandler?.({
      chat: { id: 123 },
      message: { text: "/tmp/file" },
      reply,
      replyWithChatAction,
    });

    expect(resolvePendingUserInputMock).toHaveBeenCalledWith(123, "/tmp/file");
    expect(reply).toHaveBeenCalledWith("Resuming task…");
    expect(replyWithChatAction).not.toHaveBeenCalled();
  });

  it("resets model-call retry state after a successful turn", async () => {
    const { createBot } = await import("./bot");
    const { getOrCreateSession } = await import("./agent.js");
    await createBot();

    const textHandler = botHandlers.get("message:text");
    expect(textHandler).toBeTypeOf("function");

    const sessionHandlers: Array<(event: unknown) => void> = [];
    vi.mocked(getOrCreateSession).mockResolvedValue({
      sessionId: "session-1",
      on: vi.fn((handler: (event: unknown) => void) => {
        sessionHandlers.push(handler);
        return () => {};
      }),
      send: vi.fn(async () => {
        for (const handler of sessionHandlers) {
          handler({ type: "assistant.message", data: { content: "done" } });
          handler({ type: "session.idle", data: {} });
        }
      }),
    } as never);

    const reply = vi.fn(async (text: string) => {
      if (text === "Thinking...") return { message_id: 1 };
      return {};
    });
    const replyWithChatAction = vi.fn(async () => {});

    await textHandler?.({
      chat: { id: 123 },
      message: { text: "hello" },
      reply,
      replyWithChatAction,
      api: {
        editMessageText: vi.fn(async () => {}),
        deleteMessage: vi.fn(async () => {}),
      },
    });

    expect(resetModelCallFailuresMock).toHaveBeenCalledWith("session-1");
  });

  it("unregisters the pending-input watcher after a successful turn", async () => {
    const { createBot } = await import("./bot");
    const { getOrCreateSession } = await import("./agent.js");
    await createBot();

    const textHandler = botHandlers.get("message:text");
    expect(textHandler).toBeTypeOf("function");

    const sessionHandlers: Array<(event: unknown) => void> = [];
    const unwatchPendingInput = vi.fn();
    watchPendingUserInputMock.mockReturnValue(unwatchPendingInput);
    vi.mocked(getOrCreateSession).mockResolvedValue({
      sessionId: "session-1",
      on: vi.fn((handler: (event: unknown) => void) => {
        sessionHandlers.push(handler);
        return () => {};
      }),
      send: vi.fn(async () => {
        for (const handler of sessionHandlers) {
          handler({ type: "assistant.message", data: { content: "done" } });
          handler({ type: "session.idle", data: {} });
        }
      }),
    } as never);

    const reply = vi.fn(async (text: string) => {
      if (text === "Thinking...") return { message_id: 1 };
      return {};
    });
    const replyWithChatAction = vi.fn(async () => {});

    await textHandler?.({
      chat: { id: 123 },
      message: { text: "hello" },
      reply,
      replyWithChatAction,
      api: {
        editMessageText: vi.fn(async () => {}),
        deleteMessage: vi.fn(async () => {}),
      },
    });

    expect(unwatchPendingInput).toHaveBeenCalledTimes(1);
  });

  it("clears channel-default reasoning before retrying a failover model", async () => {
    const { createBot } = await import("./bot");
    const { getOrCreateSession, getReasoningEffortForChat, switchModel, refreshSessionContext } =
      await import("./agent.js");
    const { consumePendingFailover } = await import("./hooks/error-state.js");
    await createBot();

    const textHandler = botHandlers.get("message:text");
    expect(textHandler).toBeTypeOf("function");

    vi.mocked(getReasoningEffortForChat).mockReturnValue("high");
    getChannelConfigMock.mockReturnValue({ defaultReasoningEffort: "high" } as never);
    getModelReasoningInfoMock.mockResolvedValue({
      supported: false,
      levels: [],
    });

    const firstAttemptHandlers: Array<(event: unknown) => void> = [];
    const secondAttemptHandlers: Array<(event: unknown) => void> = [];
    let attempt = 0;
    vi.mocked(getOrCreateSession).mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) {
        return {
          sessionId: "session-1",
          on: vi.fn((handler: (event: unknown) => void) => {
            firstAttemptHandlers.push(handler);
            return () => {};
          }),
          send: vi.fn(async () => {
            for (const handler of firstAttemptHandlers) {
              handler({ type: "session.error", data: { message: "boom" } });
            }
          }),
        } as never;
      }

      return {
        sessionId: "session-2",
        on: vi.fn((handler: (event: unknown) => void) => {
          secondAttemptHandlers.push(handler);
          return () => {};
        }),
        send: vi.fn(async () => {
          for (const handler of secondAttemptHandlers) {
            handler({ type: "assistant.message", data: { content: "done" } });
            handler({ type: "session.idle", data: {} });
          }
        }),
      } as never;
    });

    vi.mocked(consumePendingFailover)
      .mockReturnValueOnce({
        fromModel: "claude-opus-4-6",
        toModel: "gpt-4.1",
        attemptedModels: [],
      })
      .mockReturnValue(null);

    const reply = vi.fn(async (text: string) => {
      if (text === "Thinking...") return { message_id: 1 };
      return {};
    });
    const replyWithChatAction = vi.fn(async () => {});

    await textHandler?.({
      chat: { id: -100123 },
      message: { text: "hello" },
      reply,
      replyWithChatAction,
      api: {
        editMessageText: vi.fn(async () => {}),
        deleteMessage: vi.fn(async () => {}),
      },
    });

    expect(switchModel).toHaveBeenCalledWith(-100123, "gpt-4.1");
    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100123, {
      defaultReasoningEffort: null,
    });
    expect(refreshSessionContext).toHaveBeenCalledWith(-100123);
  });

  it("re-logs the user prompt when failover retries on a new session", async () => {
    const { createBot } = await import("./bot");
    const { getOrCreateSession } = await import("./agent.js");
    const { consumePendingFailover } = await import("./hooks/error-state.js");
    const { logMessage } = await import("./logging/conversations.js");
    const { recordMessageEstimate } = await import("./logging/cost.js");
    vi.mocked(logMessage).mockClear();
    vi.mocked(recordMessageEstimate).mockClear();
    await createBot();

    const textHandler = botHandlers.get("message:text");
    expect(textHandler).toBeTypeOf("function");

    const firstAttemptHandlers: Array<(event: unknown) => void> = [];
    const secondAttemptHandlers: Array<(event: unknown) => void> = [];
    let attempt = 0;
    vi.mocked(getOrCreateSession).mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) {
        return {
          sessionId: "session-1",
          on: vi.fn((handler: (event: unknown) => void) => {
            firstAttemptHandlers.push(handler);
            return () => {};
          }),
          send: vi.fn(async () => {
            for (const handler of firstAttemptHandlers) {
              handler({ type: "session.error", data: { message: "boom" } });
            }
          }),
        } as never;
      }

      return {
        sessionId: "session-2",
        on: vi.fn((handler: (event: unknown) => void) => {
          secondAttemptHandlers.push(handler);
          return () => {};
        }),
        send: vi.fn(async () => {
          for (const handler of secondAttemptHandlers) {
            handler({ type: "assistant.message", data: { content: "done" } });
            handler({ type: "session.idle", data: {} });
          }
        }),
      } as never;
    });

    vi.mocked(consumePendingFailover)
      .mockReturnValueOnce({
        fromModel: "claude-opus-4-6",
        toModel: "gpt-4.1",
        attemptedModels: [],
      })
      .mockReturnValue(null);

    const reply = vi.fn(async (text: string) => {
      if (text === "Thinking...") return { message_id: 1 };
      return {};
    });
    const replyWithChatAction = vi.fn(async () => {});

    await textHandler?.({
      chat: { id: 123 },
      message: { text: "hello" },
      reply,
      replyWithChatAction,
      api: {
        editMessageText: vi.fn(async () => {}),
        deleteMessage: vi.fn(async () => {}),
      },
    });

    expect(
      vi
        .mocked(logMessage)
        .mock.calls.filter(([sessionId, role]) => sessionId === "session-1" && role === "user"),
    ).toHaveLength(1);
    expect(
      vi
        .mocked(logMessage)
        .mock.calls.filter(([sessionId, role]) => sessionId === "session-2" && role === "user"),
    ).toHaveLength(1);
    expect(
      vi
        .mocked(recordMessageEstimate)
        .mock.calls.filter(([entry]) => entry.sessionId === "session-1" && entry.role === "user"),
    ).toHaveLength(1);
    expect(
      vi
        .mocked(recordMessageEstimate)
        .mock.calls.filter(([entry]) => entry.sessionId === "session-2" && entry.role === "user"),
    ).toHaveLength(1);
  });
});
