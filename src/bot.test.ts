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
  botHandlers: new Map<string, (ctx: any) => Promise<void>>(),
  resolvePendingUserInputMock: vi.fn<any>(),
  getPendingUserInputMock: vi.fn<any>(),
  registerCommandsMock: vi.fn<any>(async () => {}),
  resetModelCallFailuresMock: vi.fn<any>(),
  getModelReasoningInfoMock: vi.fn<any>(),
  watchPendingUserInputMock: vi.fn<any>(() => () => {}),
  getChannelConfigMock: vi.fn<any>(() => null),
  upsertChannelConfigMock: vi.fn<any>(),
}));

vi.mock("grammy", () => ({
  Bot: class MockBot {
    use = vi.fn<any>();
    on = vi.fn<any>((event: string, handler: (ctx: any) => Promise<void>) => {
      botHandlers.set(event, handler);
      return this;
    });
    catch = vi.fn<any>();
  },
}));

vi.mock("@grammyjs/runner", () => ({
  run: vi.fn<any>(() => ({
    stop: vi.fn<any>(),
    task: vi.fn<any>(() => Promise.resolve()),
    isRunning: vi.fn<any>(() => true),
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
  beginSessionTurn: vi.fn<any>(),
  clearReasoningEffort: vi.fn<any>(),
  consumeAbortFlag: vi.fn<any>(() => false),
  discardSession: vi.fn<any>(),
  endSessionTurn: vi.fn<any>(),
  getClient: vi.fn<any>(),
  getModelForChat: vi.fn<any>(),
  getOrCreateSession: vi.fn<any>(),
  getPerChatReasoningEffortOverride: vi.fn<any>(() => undefined),
  getReasoningEffortForChat: vi.fn<any>(() => undefined),
  hasTrackedSession: vi.fn<any>(),
  refreshSessionContext: vi.fn<any>(),
  switchModel: vi.fn<any>(),
}));

vi.mock("./logging/index.js", () => ({
  getLogger: () => ({
    info: vi.fn<any>(),
    warn: vi.fn<any>(),
    error: vi.fn<any>(),
    debug: vi.fn<any>(),
  }),
}));

vi.mock("./logging/conversations.js", () => ({
  logMessage: vi.fn<any>(),
  logToolCall: vi.fn<any>(),
  completeToolCall: vi.fn<any>(),
  getLastCompactionEventId: vi.fn<any>(),
  setLastCompactionEventId: vi.fn<any>(),
  setSessionTags: vi.fn<any>(),
}));

vi.mock("./commands/index.js", () => ({
  registerCommands: registerCommandsMock,
}));

vi.mock("./commands/model.js", () => ({
  handleModelCallback: vi.fn<any>(),
  isModelCallback: vi.fn<any>(() => false),
}));

vi.mock("./commands/model-catalog.js", () => ({
  getModelReasoningInfo: getModelReasoningInfoMock,
}));

vi.mock("./commands/reasoning.js", () => ({
  handleReasoningCallback: vi.fn<any>(),
  isReasoningCallback: vi.fn<any>(() => false),
}));

vi.mock("./commands/session.js", () => ({
  handleSessionCallback: vi.fn<any>(),
  isSessionCallback: vi.fn<any>(() => false),
}));

vi.mock("./commands/jobs.js", () => ({
  handleJobsCallback: vi.fn<any>(),
  isJobsCallback: vi.fn<any>(() => false),
}));

vi.mock("./telegram/files.js", () => ({
  downloadTelegramFile: vi.fn<any>(),
}));

vi.mock("./telegram/messages.js", () => ({
  splitMessage: vi.fn<any>((text: string) => [text]),
}));

vi.mock("./memory/index.js", () => ({
  appendCompactionMemory: vi.fn<any>(),
}));

vi.mock("./memory/db.js", () => ({
  getChannelConfig: getChannelConfigMock,
  upsertChannelConfig: upsertChannelConfigMock,
}));

vi.mock("./logging/cost.js", () => ({
  recordCompactionTokens: vi.fn<any>(),
  recordMessageEstimate: vi.fn<any>(),
}));

vi.mock("./memory/tagging.js", () => ({
  extractTags: vi.fn<any>(() => []),
}));

vi.mock("./voice/transcribe.js", () => ({
  isVoiceEnabled: vi.fn<any>(() => false),
  transcribeFile: vi.fn<any>(),
}));

vi.mock("./telegram/progress.js", () => ({
  TYPING_REFRESH_MS: 1000,
  PROGRESS_REFRESH_MS: 1000,
  PROGRESS_EDIT_DEBOUNCE_MS: 100,
  formatProgressName: vi.fn<any>((name?: string) => name ?? "tool"),
  buildProgressText: vi.fn<any>(() => "Thinking..."),
}));

vi.mock("./telegram/session-timeout.js", () => ({
  isMessageNotModifiedError: vi.fn<any>(() => false),
  isMissingProgressMessageError: vi.fn<any>(() => false),
}));

vi.mock("./telegram/user-input.js", () => ({
  cancelPendingUserInputForSession: vi.fn<any>(),
  getPendingUserInput: getPendingUserInputMock,
  resolvePendingUserInput: resolvePendingUserInputMock,
  watchPendingUserInput: watchPendingUserInputMock,
}));

vi.mock("./telegram/session-errors.js", () => ({
  shouldSilenceSessionError: vi.fn<any>(() => false),
}));

vi.mock("./hooks/error-state.js", () => ({
  clearFallbackAttemptState: vi.fn<any>(),
  consumePendingFailover: vi.fn<any>(() => null),
  consumeSessionErrorNotified: vi.fn<any>(() => false),
  consumeSessionErrorSummary: vi.fn<any>(() => null),
  markFallbackModelAttempted: vi.fn<any>(),
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

    const reply = vi.fn<any>();
    const replyWithChatAction = vi.fn<any>();

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

    const sessionHandlers: Array<(event: any) => void> = [];
    vi.mocked(getOrCreateSession).mockResolvedValue({
      sessionId: "session-1",
      on: vi.fn<any>((handler: (event: any) => void) => {
        sessionHandlers.push(handler);
        return () => {};
      }),
      send: vi.fn<any>(async () => {
        for (const handler of sessionHandlers) {
          handler({ type: "assistant.message", data: { content: "done" } });
          handler({ type: "session.idle", data: {} });
        }
      }),
    } as any);

    const reply = vi.fn<any>(async (text: string) => {
      if (text === "Thinking...") return { message_id: 1 };
      return {};
    });
    const replyWithChatAction = vi.fn<any>(async () => {});

    await textHandler?.({
      chat: { id: 123 },
      message: { text: "hello" },
      reply,
      replyWithChatAction,
      api: {
        editMessageText: vi.fn<any>(async () => {}),
        deleteMessage: vi.fn<any>(async () => {}),
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

    const sessionHandlers: Array<(event: any) => void> = [];
    const unwatchPendingInput = vi.fn<any>();
    watchPendingUserInputMock.mockReturnValue(unwatchPendingInput);
    vi.mocked(getOrCreateSession).mockResolvedValue({
      sessionId: "session-1",
      on: vi.fn<any>((handler: (event: any) => void) => {
        sessionHandlers.push(handler);
        return () => {};
      }),
      send: vi.fn<any>(async () => {
        for (const handler of sessionHandlers) {
          handler({ type: "assistant.message", data: { content: "done" } });
          handler({ type: "session.idle", data: {} });
        }
      }),
    } as any);

    const reply = vi.fn<any>(async (text: string) => {
      if (text === "Thinking...") return { message_id: 1 };
      return {};
    });
    const replyWithChatAction = vi.fn<any>(async () => {});

    await textHandler?.({
      chat: { id: 123 },
      message: { text: "hello" },
      reply,
      replyWithChatAction,
      api: {
        editMessageText: vi.fn<any>(async () => {}),
        deleteMessage: vi.fn<any>(async () => {}),
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
    getChannelConfigMock.mockReturnValue({ defaultReasoningEffort: "high" } as any);
    getModelReasoningInfoMock.mockResolvedValue({
      supported: false,
      levels: [],
    });

    const firstAttemptHandlers: Array<(event: any) => void> = [];
    const secondAttemptHandlers: Array<(event: any) => void> = [];
    let attempt = 0;
    vi.mocked(getOrCreateSession).mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) {
        return {
          sessionId: "session-1",
          on: vi.fn<any>((handler: (event: any) => void) => {
            firstAttemptHandlers.push(handler);
            return () => {};
          }),
          send: vi.fn<any>(async () => {
            for (const handler of firstAttemptHandlers) {
              handler({ type: "session.error", data: { message: "boom" } });
            }
          }),
        } as any;
      }

      return {
        sessionId: "session-2",
        on: vi.fn<any>((handler: (event: any) => void) => {
          secondAttemptHandlers.push(handler);
          return () => {};
        }),
        send: vi.fn<any>(async () => {
          for (const handler of secondAttemptHandlers) {
            handler({ type: "assistant.message", data: { content: "done" } });
            handler({ type: "session.idle", data: {} });
          }
        }),
      } as any;
    });

    vi.mocked(consumePendingFailover)
      .mockReturnValueOnce({
        fromModel: "claude-opus-4-6",
        toModel: "gpt-4.1",
      } as any)
      .mockReturnValue(null);

    const reply = vi.fn<any>(async (text: string) => {
      if (text === "Thinking...") return { message_id: 1 };
      return {};
    });
    const replyWithChatAction = vi.fn<any>(async () => {});

    await textHandler?.({
      chat: { id: -100123 },
      message: { text: "hello" },
      reply,
      replyWithChatAction,
      api: {
        editMessageText: vi.fn<any>(async () => {}),
        deleteMessage: vi.fn<any>(async () => {}),
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

    const firstAttemptHandlers: Array<(event: any) => void> = [];
    const secondAttemptHandlers: Array<(event: any) => void> = [];
    let attempt = 0;
    vi.mocked(getOrCreateSession).mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) {
        return {
          sessionId: "session-1",
          on: vi.fn<any>((handler: (event: any) => void) => {
            firstAttemptHandlers.push(handler);
            return () => {};
          }),
          send: vi.fn<any>(async () => {
            for (const handler of firstAttemptHandlers) {
              handler({ type: "session.error", data: { message: "boom" } });
            }
          }),
        } as any;
      }

      return {
        sessionId: "session-2",
        on: vi.fn<any>((handler: (event: any) => void) => {
          secondAttemptHandlers.push(handler);
          return () => {};
        }),
        send: vi.fn<any>(async () => {
          for (const handler of secondAttemptHandlers) {
            handler({ type: "assistant.message", data: { content: "done" } });
            handler({ type: "session.idle", data: {} });
          }
        }),
      } as any;
    });

    vi.mocked(consumePendingFailover)
      .mockReturnValueOnce({
        fromModel: "claude-opus-4-6",
        toModel: "gpt-4.1",
      } as any)
      .mockReturnValue(null);

    const reply = vi.fn<any>(async (text: string) => {
      if (text === "Thinking...") return { message_id: 1 };
      return {};
    });
    const replyWithChatAction = vi.fn<any>(async () => {});

    await textHandler?.({
      chat: { id: 123 },
      message: { text: "hello" },
      reply,
      replyWithChatAction,
      api: {
        editMessageText: vi.fn<any>(async () => {}),
        deleteMessage: vi.fn<any>(async () => {}),
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
