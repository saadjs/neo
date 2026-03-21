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
} = vi.hoisted(() => ({
  botHandlers: new Map<string, (ctx: any) => Promise<void>>(),
  resolvePendingUserInputMock: vi.fn(),
  getPendingUserInputMock: vi.fn(),
  registerCommandsMock: vi.fn(async () => {}),
  resetModelCallFailuresMock: vi.fn(),
}));

vi.mock("grammy", () => ({
  Bot: class MockBot {
    use = vi.fn();
    on = vi.fn((event: string, handler: (ctx: any) => Promise<void>) => {
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
  consumeAbortFlag: vi.fn(() => false),
  discardSession: vi.fn(),
  endSessionTurn: vi.fn(),
  getClient: vi.fn(),
  getModelForChat: vi.fn(),
  getOrCreateSession: vi.fn(),
  hasTrackedSession: vi.fn(),
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
  watchPendingUserInput: vi.fn(() => () => {}),
}));

vi.mock("./telegram/session-errors.js", () => ({
  shouldSilenceSessionError: vi.fn(() => false),
}));

vi.mock("./hooks/error-state.js", () => ({
  consumeSessionErrorNotified: vi.fn(() => false),
}));

vi.mock("./hooks/error.js", () => ({
  resetModelCallFailures: resetModelCallFailuresMock,
}));

afterEach(() => {
  botHandlers.clear();
  resolvePendingUserInputMock.mockReset();
  getPendingUserInputMock.mockReset();
  registerCommandsMock.mockClear();
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

    const sessionHandlers: Array<(event: any) => void> = [];
    vi.mocked(getOrCreateSession).mockResolvedValue({
      sessionId: "session-1",
      on: vi.fn((handler: (event: any) => void) => {
        sessionHandlers.push(handler);
        return () => {};
      }),
      send: vi.fn(async () => {
        for (const handler of sessionHandlers) {
          handler({ type: "assistant.message", data: { content: "done" } });
          handler({ type: "session.idle", data: {} });
        }
      }),
    } as any);

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
});
