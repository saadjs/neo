import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutboundTransport } from "./transport/types";

const {
  createSessionMock,
  resumeSessionMock,
  deleteSessionMock,
  clientStartMock,
  clientStopMock,
  buildSystemContextMock,
  logSessionMock,
  clearActiveSessionMock,
  setActiveSessionMock,
  getActiveSessionIdMock,
  approveAllMock,
  requestTransportUserInputMock,
  requestUserInputMock,
  cancelPendingUserInputMock,
  cancelAllPendingUserInputsMock,
} = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  resumeSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  clientStartMock: vi.fn(),
  clientStopMock: vi.fn(),
  buildSystemContextMock: vi.fn(),
  logSessionMock: vi.fn(),
  clearActiveSessionMock: vi.fn(),
  setActiveSessionMock: vi.fn(),
  getActiveSessionIdMock: vi.fn(),
  approveAllMock: vi.fn(),
  requestTransportUserInputMock: vi.fn(),
  requestUserInputMock: vi.fn(),
  cancelPendingUserInputMock: vi.fn(),
  cancelAllPendingUserInputsMock: vi.fn(),
}));

vi.mock("@github/copilot-sdk", () => ({
  approveAll: approveAllMock,
  CopilotClient: class {
    start = clientStartMock;
    stop = clientStopMock;
    createSession = createSessionMock;
    resumeSession = resumeSessionMock;
    deleteSession = deleteSessionMock;
  },
  CopilotSession: class {},
}));

vi.mock("./config.js", () => ({
  config: {
    github: { token: "token" },
    copilot: {
      model: "gpt-4.1",
      skillDirectories: [],
      contextCompaction: {
        enabled: true,
        threshold: 0.8,
        bufferExhaustionThreshold: 0.95,
      },
    },
    paths: {
      root: "/tmp/neo",
      data: "/tmp/neo-data",
    },
  },
}));

vi.mock("./tools/index.js", () => ({
  allTools: [],
}));

vi.mock("./memory/index.js", () => ({
  buildSystemContext: buildSystemContextMock,
}));

vi.mock("./logging/index.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("./logging/conversations.js", () => ({
  clearActiveSession: clearActiveSessionMock,
  logSession: logSessionMock,
  setActiveSession: setActiveSessionMock,
  getActiveSessionId: getActiveSessionIdMock,
}));

vi.mock("./hooks/index.js", () => ({
  buildSessionHooks: vi.fn(() => ({ onSessionStart: vi.fn() })),
}));

vi.mock("./transport/user-input.js", () => ({
  requestUserInput: requestTransportUserInputMock,
  cancelAllPendingUserInputs: cancelAllPendingUserInputsMock,
}));

vi.mock("./telegram/user-input.js", () => ({
  requestUserInput: requestUserInputMock,
  cancelPendingUserInput: cancelPendingUserInputMock,
}));

afterEach(async () => {
  const { stopAgent } = await import("./agent");
  await stopAgent();
  vi.resetModules();
  createSessionMock.mockReset();
  resumeSessionMock.mockReset();
  deleteSessionMock.mockReset();
  clientStartMock.mockReset();
  clientStopMock.mockReset();
  buildSystemContextMock.mockReset();
  logSessionMock.mockReset();
  clearActiveSessionMock.mockReset();
  setActiveSessionMock.mockReset();
  getActiveSessionIdMock.mockReset();
  approveAllMock.mockReset();
  requestTransportUserInputMock.mockReset();
  requestUserInputMock.mockReset();
  cancelPendingUserInputMock.mockReset();
  cancelAllPendingUserInputsMock.mockReset();
});

describe("refreshSessionContext", () => {
  it("registers the ask_user bridge for interactive sessions", async () => {
    const session = {
      sessionId: "session-ask",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock.mockResolvedValue(session);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);
    requestUserInputMock.mockResolvedValue({ answer: "yes", wasFreeform: true });

    const { createNewSession, startAgent } = await import("./agent");

    await startAgent();
    await createNewSession({ chatId: "-100123" });

    const configArg = createSessionMock.mock.calls[0]?.[0];
    expect(configArg.onUserInputRequest).toBeTypeOf("function");

    await expect(
      configArg.onUserInputRequest({ question: "Proceed?" }, { sessionId: "session-ask" }),
    ).resolves.toEqual({ answer: "yes", wasFreeform: true });
    expect(requestUserInputMock).toHaveBeenCalledWith("-100123", "session-ask", {
      question: "Proceed?",
    });
  });

  it("routes ask_user through the session origin transport when available", async () => {
    const session = {
      sessionId: "session-ask",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const transport: OutboundTransport = {
      platform: "discord" as const,
      capabilities: {
        editableMessages: true,
        typingIndicators: true,
        commands: true,
        interactiveInput: true,
        photoDelivery: true,
        voiceMessages: false,
      },
      sendText: vi.fn(),
      editText: vi.fn(),
      deleteMessage: vi.fn(),
      indicateTyping: vi.fn(),
      sendPhoto: vi.fn(),
      requestUserInput: vi.fn(),
      clearUserInputPrompt: vi.fn(),
    };

    createSessionMock.mockResolvedValue(session);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);
    requestTransportUserInputMock.mockResolvedValue({ answer: "yes", wasFreeform: true });

    const { createNewSession, startAgent } = await import("./agent");

    await startAgent();
    await createNewSession({
      chatId: "discord-thread-1",
      origin: {
        conversation: {
          platform: "discord",
          id: "thread-1",
          kind: "channel",
        },
        transport,
      },
    });

    const configArg = createSessionMock.mock.calls[0]?.[0];

    await expect(
      configArg.onUserInputRequest({ question: "Proceed?" }, { sessionId: "session-ask" }),
    ).resolves.toEqual({ answer: "yes", wasFreeform: true });
    expect(requestTransportUserInputMock).toHaveBeenCalledWith({
      conversation: {
        platform: "discord",
        id: "thread-1",
        kind: "channel",
      },
      sessionId: "session-ask",
      transport,
      request: {
        question: "Proceed?",
      },
    });
    expect(requestUserInputMock).not.toHaveBeenCalled();
  });

  it("destroys an idle cached session immediately and deletes from disk", async () => {
    const session = {
      sessionId: "session-1",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock.mockResolvedValue(session);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);

    const { createNewSession, getSessionForChat, refreshSessionContext, startAgent } =
      await import("./agent");

    await startAgent();
    await createNewSession({ chatId: "-100123" });
    expect(getSessionForChat("-100123")).toBe(session);

    await refreshSessionContext("-100123");

    expect(clearActiveSessionMock).toHaveBeenCalledWith("-100123");
    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(deleteSessionMock).toHaveBeenCalledWith("session-1");
    expect(getSessionForChat("-100123")).toBeUndefined();
  });

  it("defers destroying an in-use session until the turn ends", async () => {
    const staleSession = {
      sessionId: "session-2",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const freshSession = {
      sessionId: "session-3",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock.mockResolvedValueOnce(staleSession).mockResolvedValueOnce(freshSession);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);

    const {
      beginSessionTurn,
      createNewSession,
      endSessionTurn,
      getChatIdForSession,
      getOrCreateSession,
      getSessionForChat,
      refreshSessionContext,
      startAgent,
    } = await import("./agent");

    await startAgent();
    await createNewSession({ chatId: "-100123" });
    beginSessionTurn("-100123");

    await refreshSessionContext("-100123");

    expect(clearActiveSessionMock).toHaveBeenCalledWith("-100123");
    expect(staleSession.disconnect).toHaveBeenCalledTimes(0);
    expect(getSessionForChat("-100123")).toBeUndefined();
    expect(getChatIdForSession("session-2")).toBe("-100123");
    await expect(getOrCreateSession({ chatId: "-100123" })).resolves.toBe(freshSession);
    expect(getSessionForChat("-100123")).toBe(freshSession);

    await endSessionTurn("-100123");

    expect(staleSession.disconnect).toHaveBeenCalledTimes(1);
    expect(deleteSessionMock).toHaveBeenCalledWith("session-2");
    expect(freshSession.disconnect).not.toHaveBeenCalled();
    expect(getSessionForChat("-100123")).toBe(freshSession);
  });

  it("destroys every stale session after overlapping refreshed turns finish", async () => {
    const firstSession = {
      sessionId: "session-1",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const secondSession = {
      sessionId: "session-2",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const thirdSession = {
      sessionId: "session-3",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession)
      .mockResolvedValueOnce(thirdSession);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);

    const {
      beginSessionTurn,
      createNewSession,
      endSessionTurn,
      getOrCreateSession,
      getSessionForChat,
      refreshSessionContext,
      startAgent,
    } = await import("./agent");

    await startAgent();
    await createNewSession({ chatId: "-100123" });

    beginSessionTurn("-100123");
    await refreshSessionContext("-100123");
    await expect(getOrCreateSession({ chatId: "-100123" })).resolves.toBe(secondSession);

    beginSessionTurn("-100123");
    await refreshSessionContext("-100123");
    await expect(getOrCreateSession({ chatId: "-100123" })).resolves.toBe(thirdSession);
    expect(getSessionForChat("-100123")).toBe(thirdSession);

    await endSessionTurn("-100123");
    expect(firstSession.disconnect).not.toHaveBeenCalled();
    expect(secondSession.disconnect).not.toHaveBeenCalled();

    await endSessionTurn("-100123");
    expect(firstSession.disconnect).toHaveBeenCalledTimes(1);
    expect(secondSession.disconnect).toHaveBeenCalledTimes(1);
    expect(deleteSessionMock).toHaveBeenCalledWith("session-1");
    expect(deleteSessionMock).toHaveBeenCalledWith("session-2");
    expect(thirdSession.disconnect).not.toHaveBeenCalled();
  });

  it("does not resume the previous persisted session after a context refresh", async () => {
    const staleSession = {
      sessionId: "session-stale",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const freshSession = {
      sessionId: "session-fresh",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock.mockResolvedValueOnce(staleSession).mockResolvedValueOnce(freshSession);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue("session-stale");
    clearActiveSessionMock.mockImplementation(() => {
      getActiveSessionIdMock.mockReturnValue(undefined);
    });

    const { createNewSession, getOrCreateSession, refreshSessionContext, startAgent } =
      await import("./agent");

    await startAgent();
    await createNewSession({ chatId: "-100123" });

    await refreshSessionContext("-100123");
    const nextSession = await getOrCreateSession({ chatId: "-100123" });

    expect(clearActiveSessionMock).toHaveBeenCalledWith("-100123");
    expect(resumeSessionMock).not.toHaveBeenCalled();
    expect(nextSession).toBe(freshSession);
    expect(createSessionMock).toHaveBeenCalledTimes(2);
  });

  it("keeps stale sessions alive when overlapping replacement creation fails", async () => {
    const staleSession = {
      sessionId: "session-stale",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock
      .mockResolvedValueOnce(staleSession)
      .mockRejectedValueOnce(new Error("create failed"))
      .mockResolvedValueOnce({
        sessionId: "session-fresh",
        destroy: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
      });
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);

    const {
      beginSessionTurn,
      createNewSession,
      endSessionTurn,
      getOrCreateSession,
      refreshSessionContext,
      startAgent,
    } = await import("./agent");

    await startAgent();
    await createNewSession({ chatId: "-100123" });

    beginSessionTurn("-100123");
    await refreshSessionContext("-100123");

    beginSessionTurn("-100123");
    await expect(getOrCreateSession({ chatId: "-100123" })).rejects.toThrow("create failed");

    expect(staleSession.disconnect).not.toHaveBeenCalled();

    await endSessionTurn("-100123");
    expect(staleSession.disconnect).not.toHaveBeenCalled();

    await endSessionTurn("-100123");
    expect(staleSession.disconnect).toHaveBeenCalledTimes(1);
    expect(deleteSessionMock).toHaveBeenCalledWith("session-stale");
  });
});

describe("discardSession", () => {
  it("clears the active cached session and persisted session id", async () => {
    const session = {
      sessionId: "session-active",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock.mockResolvedValue(session);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);

    const { createNewSession, discardSession, getSessionForChat, startAgent } =
      await import("./agent");

    await startAgent();
    await createNewSession({ chatId: "-100123" });
    expect(getSessionForChat("-100123")).toBe(session);

    discardSession("-100123", session as never);

    expect(getSessionForChat("-100123")).toBeUndefined();
    expect(clearActiveSessionMock).toHaveBeenCalledWith("-100123");
  });

  it("removes a stale session from lookup without touching the active session", async () => {
    const staleSession = {
      sessionId: "session-stale",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const freshSession = {
      sessionId: "session-fresh",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock.mockResolvedValueOnce(staleSession).mockResolvedValueOnce(freshSession);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);

    const {
      beginSessionTurn,
      createNewSession,
      discardSession,
      getChatIdForSession,
      getOrCreateSession,
      getSessionForChat,
      refreshSessionContext,
      startAgent,
    } = await import("./agent");

    await startAgent();
    await createNewSession({ chatId: "-100123" });
    beginSessionTurn("-100123");
    await refreshSessionContext("-100123");

    expect(getChatIdForSession("session-stale")).toBe("-100123");

    await expect(getOrCreateSession({ chatId: "-100123" })).resolves.toBe(freshSession);
    clearActiveSessionMock.mockClear();
    discardSession("-100123", staleSession as never);

    expect(getChatIdForSession("session-stale")).toBeUndefined();
    expect(getSessionForChat("-100123")).toBe(freshSession);
    expect(clearActiveSessionMock).not.toHaveBeenCalled();
  });

  it("reports stale refreshed sessions as still tracked until they are discarded", async () => {
    const staleSession = {
      sessionId: "session-stale",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const freshSession = {
      sessionId: "session-fresh",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock.mockResolvedValueOnce(staleSession).mockResolvedValueOnce(freshSession);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);

    const {
      beginSessionTurn,
      createNewSession,
      discardSession,
      getOrCreateSession,
      hasTrackedSession,
      refreshSessionContext,
      startAgent,
    } = await import("./agent");

    await startAgent();
    await createNewSession({ chatId: "-100123" });
    beginSessionTurn("-100123");
    await refreshSessionContext("-100123");

    expect(hasTrackedSession("-100123", staleSession as never)).toBe(true);

    await expect(getOrCreateSession({ chatId: "-100123" })).resolves.toBe(freshSession);
    expect(hasTrackedSession("-100123", staleSession as never)).toBe(true);

    discardSession("-100123", staleSession as never);
    expect(hasTrackedSession("-100123", staleSession as never)).toBe(false);
  });
});

describe("destroySession", () => {
  it("disconnects the active session without deleting persisted history by default", async () => {
    const session = {
      sessionId: "session-active",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock.mockResolvedValue(session);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);

    const { createNewSession, destroySession, getSessionForChat, startAgent } =
      await import("./agent");

    await startAgent();
    await createNewSession({ chatId: "-100123" });

    await destroySession("-100123");

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(deleteSessionMock).not.toHaveBeenCalled();
    expect(clearActiveSessionMock).toHaveBeenCalledWith("-100123");
    expect(getSessionForChat("-100123")).toBeUndefined();
  });

  it("deletes persisted history when explicitly requested", async () => {
    const session = {
      sessionId: "session-active",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock.mockResolvedValue(session);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);

    const { createNewSession, destroySession, startAgent } = await import("./agent");

    await startAgent();
    await createNewSession({ chatId: "-100123" });

    await destroySession("-100123", { deletePersisted: true });

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(deleteSessionMock).toHaveBeenCalledWith("session-active");
  });
});
