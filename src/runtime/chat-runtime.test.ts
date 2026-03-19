import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "@github/copilot-sdk";
import type { OutboundTransport, ConversationRef } from "../transport/types";

const {
  beginSessionTurnMock,
  endSessionTurnMock,
  getOrCreateSessionMock,
  getModelForChatMock,
  hasTrackedSessionMock,
  consumeAbortFlagMock,
  discardSessionMock,
  shouldSilenceSessionErrorMock,
  consumeSessionErrorNotifiedMock,
  cancelPendingUserInputForSessionMock,
  session,
  transport,
  emitSessionEvent,
} = vi.hoisted(() => {
  const listeners = new Set<(event: SessionEvent) => void>();
  const emit = (event: SessionEvent) => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const session = {
    sessionId: "session-1",
    on: vi.fn((handler: (event: SessionEvent) => void) => {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    }),
    send: vi.fn(async () => {
      emit({
        id: "assistant-1",
        type: "assistant.message",
        timestamp: new Date().toISOString(),
        data: { content: "Hello from runtime" },
      } as SessionEvent);
      emit({
        id: "idle-1",
        type: "session.idle",
        timestamp: new Date().toISOString(),
        data: {},
      } as SessionEvent);
    }),
  };

  const transport: OutboundTransport = {
    platform: "telegram",
    capabilities: {
      editableMessages: true,
      typingIndicators: true,
      commands: true,
      interactiveInput: true,
      photoDelivery: true,
      voiceMessages: true,
    },
    sendText: vi.fn(async () => ({ id: String(Math.random()) })),
    editText: vi.fn(async () => {}),
    deleteMessage: vi.fn(async () => {}),
    indicateTyping: vi.fn(async () => {}),
    sendPhoto: vi.fn(async () => ({ id: "photo" })),
    requestUserInput: vi.fn(async () => ({ id: "prompt" })),
    clearUserInputPrompt: vi.fn(async () => {}),
  };

  return {
    beginSessionTurnMock: vi.fn(),
    endSessionTurnMock: vi.fn(async () => {}),
    getOrCreateSessionMock: vi.fn(async () => session),
    getModelForChatMock: vi.fn(() => "gpt-4.1"),
    hasTrackedSessionMock: vi.fn(() => true),
    consumeAbortFlagMock: vi.fn(() => false),
    discardSessionMock: vi.fn(),
    shouldSilenceSessionErrorMock: vi.fn(() => false),
    consumeSessionErrorNotifiedMock: vi.fn(() => false),
    cancelPendingUserInputForSessionMock: vi.fn(async () => false),
    session,
    transport,
    emitSessionEvent: emit,
  };
});

vi.mock("../agent.js", () => ({
  beginSessionTurn: beginSessionTurnMock,
  consumeAbortFlag: consumeAbortFlagMock,
  discardSession: discardSessionMock,
  endSessionTurn: endSessionTurnMock,
  getClient: vi.fn(() => ({ getState: () => "connected" })),
  getModelForChat: getModelForChatMock,
  getOrCreateSession: getOrCreateSessionMock,
  hasTrackedSession: hasTrackedSessionMock,
}));

vi.mock("../logging/index.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../logging/conversations.js", () => ({
  logMessage: vi.fn(),
  logToolCall: vi.fn(),
  completeToolCall: vi.fn(),
  getLastCompactionEventId: vi.fn(() => undefined),
  setLastCompactionEventId: vi.fn(),
  setSessionTags: vi.fn(),
}));

vi.mock("../memory/index.js", () => ({
  appendCompactionMemory: vi.fn(),
}));

vi.mock("../memory/tagging.js", () => ({
  extractTags: vi.fn(() => []),
}));

vi.mock("../logging/cost.js", () => ({
  recordCompactionTokens: vi.fn(),
  recordMessageEstimate: vi.fn(),
}));

vi.mock("./session-errors.js", () => ({
  shouldSilenceSessionError: shouldSilenceSessionErrorMock,
}));

vi.mock("../hooks/error-state.js", () => ({
  consumeSessionErrorNotified: consumeSessionErrorNotifiedMock,
}));

vi.mock("./progress.js", () => ({
  buildProgressText: vi.fn(() => "Thinking..."),
  formatProgressName: vi.fn((name?: string) => name ?? "tool"),
}));

vi.mock("./messages.js", () => ({
  splitMessage: vi.fn((text: string) => [text]),
}));

vi.mock("../transport/user-input.js", () => ({
  cancelPendingUserInputForSession: cancelPendingUserInputForSessionMock,
  watchPendingUserInput: vi.fn(() => () => {}),
}));

const conversation: ConversationRef = {
  platform: "telegram",
  id: "123",
  kind: "dm",
  metadata: { sessionScopeId: 123 },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("handleRuntimeMessage", () => {
  it("streams assistant orchestration through the transport abstraction", async () => {
    const { handleRuntimeMessage } = await import("./chat-runtime");

    await handleRuntimeMessage(transport, {
      conversation,
      text: "Hello",
    });

    expect(beginSessionTurnMock).toHaveBeenCalledWith("123");
    expect(getOrCreateSessionMock).toHaveBeenCalledWith({ chatId: "123" });
    expect(session.send).toHaveBeenCalledWith({ prompt: "Hello", attachments: undefined });
    expect(transport.indicateTyping).toHaveBeenCalled();

    const sentCalls = vi.mocked(transport.sendText).mock.calls;
    expect(sentCalls.at(-1)).toEqual([
      expect.objectContaining({ id: "123", platform: "telegram" }),
      "Hello from runtime",
      { format: "markdown" },
    ]);
    expect(endSessionTurnMock).toHaveBeenCalledWith("123");
  });

  it("sends _(no response)_ when the session produces no content", async () => {
    session.send.mockImplementationOnce(async () => {
      emitSessionEvent({
        id: "idle-1",
        type: "session.idle",
        timestamp: new Date().toISOString(),
        data: {},
      } as SessionEvent);
    });

    const { handleRuntimeMessage } = await import("./chat-runtime");

    await handleRuntimeMessage(transport, { conversation, text: "Hello" });

    const sentCalls = vi.mocked(transport.sendText).mock.calls;
    const lastCall = sentCalls.at(-1);
    expect(lastCall?.[1]).toBe("_(no response)_");
    expect(lastCall?.[2]).toEqual({ format: "markdown" });
  });

  it("suppresses output and cleans up when the abort flag is set", async () => {
    consumeAbortFlagMock.mockReturnValueOnce(true);

    const { handleRuntimeMessage } = await import("./chat-runtime");

    await handleRuntimeMessage(transport, { conversation, text: "Hello" });

    const sentCalls = vi.mocked(transport.sendText).mock.calls;
    const hasResponseSend = sentCalls.some(
      (call) => typeof call[1] === "string" && call[1].includes("Hello from runtime"),
    );
    expect(hasResponseSend).toBe(false);
    expect(endSessionTurnMock).toHaveBeenCalledWith("123");
  });

  it("sends error message to user when session throws", async () => {
    session.send.mockImplementationOnce(async () => {
      throw new Error("Session exploded");
    });

    const { handleRuntimeMessage } = await import("./chat-runtime");

    await handleRuntimeMessage(transport, { conversation, text: "Hello" });

    const sentCalls = vi.mocked(transport.sendText).mock.calls;
    const errorCall = sentCalls.find(
      (call) => typeof call[1] === "string" && call[1].includes("Something went wrong"),
    );
    expect(errorCall).toBeDefined();
    expect(endSessionTurnMock).toHaveBeenCalledWith("123");
  });

  it("silences errors when shouldSilenceSessionError returns true", async () => {
    session.send.mockImplementationOnce(async () => {
      throw new Error("Silenceable error");
    });
    shouldSilenceSessionErrorMock.mockReturnValueOnce(true);

    const { handleRuntimeMessage } = await import("./chat-runtime");

    await handleRuntimeMessage(transport, { conversation, text: "Hello" });

    const sentCalls = vi.mocked(transport.sendText).mock.calls;
    const errorCall = sentCalls.find(
      (call) => typeof call[1] === "string" && call[1].includes("Something went wrong"),
    );
    expect(errorCall).toBeUndefined();
  });

  it("skips user-facing error when hook already notified the user", async () => {
    session.send.mockImplementationOnce(async () => {
      throw new Error("Hook-notified error");
    });
    consumeSessionErrorNotifiedMock.mockReturnValueOnce(true);

    const { handleRuntimeMessage } = await import("./chat-runtime");

    await handleRuntimeMessage(transport, { conversation, text: "Hello" });

    const sentCalls = vi.mocked(transport.sendText).mock.calls;
    const errorCall = sentCalls.find(
      (call) => typeof call[1] === "string" && call[1].includes("Something went wrong"),
    );
    expect(errorCall).toBeUndefined();
  });

  it("forwards attachments to session.send", async () => {
    const { handleRuntimeMessage } = await import("./chat-runtime");

    await handleRuntimeMessage(transport, {
      conversation,
      text: "Check this image",
      attachments: [
        { kind: "image", path: "/tmp/photo.jpg", fileName: "photo.jpg", sourceId: "abc" },
      ],
    });

    expect(session.send).toHaveBeenCalledWith({
      prompt: "Check this image",
      attachments: [{ type: "file", path: "/tmp/photo.jpg", displayName: "photo.jpg" }],
    });
  });

  it("cancels pending user input on session error", async () => {
    session.send.mockImplementationOnce(async () => {
      throw new Error("Session failed");
    });

    const { handleRuntimeMessage } = await import("./chat-runtime");

    await handleRuntimeMessage(transport, { conversation, text: "Hello" });

    expect(cancelPendingUserInputForSessionMock).toHaveBeenCalledWith(
      conversation,
      "session-1",
      "The pending question was cancelled because the session ended.",
    );
  });
});
