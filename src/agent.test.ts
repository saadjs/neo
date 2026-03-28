import { afterEach, describe, expect, it, vi } from "vitest";

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
  requestUserInputMock,
  cancelPendingUserInputMock,
  cancelAllPendingUserInputsMock,
  getChannelConfigMock,
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
  requestUserInputMock: vi.fn(),
  cancelPendingUserInputMock: vi.fn(),
  cancelAllPendingUserInputsMock: vi.fn(),
  getChannelConfigMock: vi.fn(),
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
    providers: {
      anthropicApiKey: undefined,
      openaiApiKey: undefined,
      vercelAiGatewayApiKey: undefined,
      custom: {
        name: undefined,
        type: undefined,
        baseUrl: undefined,
        apiKey: undefined,
        bearerToken: undefined,
      },
    },
    service: { systemdUnit: "neo", systemctlScope: "user" },
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

vi.mock("./telegram/user-input.js", () => ({
  requestUserInput: requestUserInputMock,
  cancelPendingUserInput: cancelPendingUserInputMock,
  cancelAllPendingUserInputs: cancelAllPendingUserInputsMock,
}));

vi.mock("./memory/db.js", () => ({
  getChannelConfig: getChannelConfigMock,
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
  requestUserInputMock.mockReset();
  cancelPendingUserInputMock.mockReset();
  cancelAllPendingUserInputsMock.mockReset();
  getChannelConfigMock.mockReset();
  const { config } = await import("./config.js");
  config.copilot.model = "gpt-4.1";
  config.providers.anthropicApiKey = undefined;
  config.providers.openaiApiKey = undefined;
  config.providers.vercelAiGatewayApiKey = undefined;
  config.providers.custom.name = undefined;
  config.providers.custom.type = undefined;
  config.providers.custom.baseUrl = undefined;
  config.providers.custom.apiKey = undefined;
  config.providers.custom.bearerToken = undefined;
});

describe("refreshSessionContext", () => {
  it("creates sessions with the channel default model when no per-chat override exists", async () => {
    const chatId = -300001;
    const session = {
      sessionId: "session-channel-default",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock.mockResolvedValue(session);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);
    getChannelConfigMock.mockReturnValue({ defaultModel: "channel-model" });

    const { createNewSession, startAgent } = await import("./agent");

    await startAgent();
    await createNewSession({ chatId });

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "channel-model" }),
    );
  });

  it("reapplies the channel default model when resuming a session", async () => {
    const chatId = -300002;
    const resumedSession = {
      sessionId: "session-resumed",
      setModel: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    resumeSessionMock.mockResolvedValue(resumedSession);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue("session-resumed");
    getChannelConfigMock.mockReturnValue({ defaultModel: "channel-model" });

    const { getOrCreateSession, startAgent } = await import("./agent");

    await startAgent();
    await getOrCreateSession({ chatId });

    expect(resumeSessionMock).toHaveBeenCalled();
    expect(resumedSession.setModel).toHaveBeenCalledWith("channel-model");
  });

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
    await createNewSession({ chatId: -100123 });

    const configArg = createSessionMock.mock.calls[0]?.[0];
    expect(configArg.onUserInputRequest).toBeTypeOf("function");

    await expect(
      configArg.onUserInputRequest({ question: "Proceed?" }, { sessionId: "session-ask" }),
    ).resolves.toEqual({ answer: "yes", wasFreeform: true });
    expect(requestUserInputMock).toHaveBeenCalledWith(-100123, "session-ask", {
      question: "Proceed?",
    });
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
    await createNewSession({ chatId: -100123 });
    expect(getSessionForChat(-100123)).toBe(session);

    await refreshSessionContext(-100123);

    expect(clearActiveSessionMock).toHaveBeenCalledWith(-100123);
    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(deleteSessionMock).toHaveBeenCalledWith("session-1");
    expect(getSessionForChat(-100123)).toBeUndefined();
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
    await createNewSession({ chatId: -100123 });
    beginSessionTurn(-100123);

    await refreshSessionContext(-100123);

    expect(clearActiveSessionMock).toHaveBeenCalledWith(-100123);
    expect(staleSession.disconnect).toHaveBeenCalledTimes(0);
    expect(getSessionForChat(-100123)).toBeUndefined();
    expect(getChatIdForSession("session-2")).toBe(-100123);
    await expect(getOrCreateSession({ chatId: -100123 })).resolves.toBe(freshSession);
    expect(getSessionForChat(-100123)).toBe(freshSession);

    await endSessionTurn(-100123);

    expect(staleSession.disconnect).toHaveBeenCalledTimes(1);
    expect(deleteSessionMock).toHaveBeenCalledWith("session-2");
    expect(freshSession.disconnect).not.toHaveBeenCalled();
    expect(getSessionForChat(-100123)).toBe(freshSession);
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
    await createNewSession({ chatId: -100123 });

    beginSessionTurn(-100123);
    await refreshSessionContext(-100123);
    await expect(getOrCreateSession({ chatId: -100123 })).resolves.toBe(secondSession);

    beginSessionTurn(-100123);
    await refreshSessionContext(-100123);
    await expect(getOrCreateSession({ chatId: -100123 })).resolves.toBe(thirdSession);
    expect(getSessionForChat(-100123)).toBe(thirdSession);

    await endSessionTurn(-100123);
    expect(firstSession.disconnect).not.toHaveBeenCalled();
    expect(secondSession.disconnect).not.toHaveBeenCalled();

    await endSessionTurn(-100123);
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
    await createNewSession({ chatId: -100123 });

    await refreshSessionContext(-100123);
    const nextSession = await getOrCreateSession({ chatId: -100123 });

    expect(clearActiveSessionMock).toHaveBeenCalledWith(-100123);
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
    await createNewSession({ chatId: -100123 });

    beginSessionTurn(-100123);
    await refreshSessionContext(-100123);

    beginSessionTurn(-100123);
    await expect(getOrCreateSession({ chatId: -100123 })).rejects.toThrow("create failed");

    expect(staleSession.disconnect).not.toHaveBeenCalled();

    await endSessionTurn(-100123);
    expect(staleSession.disconnect).not.toHaveBeenCalled();

    await endSessionTurn(-100123);
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
    await createNewSession({ chatId: -100123 });
    expect(getSessionForChat(-100123)).toBe(session);

    discardSession(-100123, session as never);

    expect(getSessionForChat(-100123)).toBeUndefined();
    expect(clearActiveSessionMock).toHaveBeenCalledWith(-100123);
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
    await createNewSession({ chatId: -100123 });
    beginSessionTurn(-100123);
    await refreshSessionContext(-100123);

    expect(getChatIdForSession("session-stale")).toBe(-100123);

    await expect(getOrCreateSession({ chatId: -100123 })).resolves.toBe(freshSession);
    clearActiveSessionMock.mockClear();
    discardSession(-100123, staleSession as never);

    expect(getChatIdForSession("session-stale")).toBeUndefined();
    expect(getSessionForChat(-100123)).toBe(freshSession);
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
    await createNewSession({ chatId: -100123 });
    beginSessionTurn(-100123);
    await refreshSessionContext(-100123);

    expect(hasTrackedSession(-100123, staleSession as never)).toBe(true);

    await expect(getOrCreateSession({ chatId: -100123 })).resolves.toBe(freshSession);
    expect(hasTrackedSession(-100123, staleSession as never)).toBe(true);

    discardSession(-100123, staleSession as never);
    expect(hasTrackedSession(-100123, staleSession as never)).toBe(false);
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
    await createNewSession({ chatId: -100123 });

    await destroySession(-100123);

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(deleteSessionMock).not.toHaveBeenCalled();
    expect(clearActiveSessionMock).toHaveBeenCalledWith(-100123);
    expect(getSessionForChat(-100123)).toBeUndefined();
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
    await createNewSession({ chatId: -100123 });

    await destroySession(-100123, { deletePersisted: true });

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(deleteSessionMock).toHaveBeenCalledWith("session-active");
  });
});

describe("getModelForChat", () => {
  it("uses per-chat override over channel default", async () => {
    getChannelConfigMock.mockReturnValue({ defaultModel: "channel-model" });

    const { getModelForChat, startAgent, switchModel } = await import("./agent");
    await startAgent();
    await switchModel(-100123, "chat-model");

    expect(getModelForChat(-100123)).toBe("chat-model");
  });

  it("falls back to channel default when no per-chat override", async () => {
    getChannelConfigMock.mockReturnValue({ defaultModel: "channel-model" });

    const { getModelForChat, startAgent } = await import("./agent");
    await startAgent();

    expect(getModelForChat(-200001)).toBe("channel-model");
  });

  it("falls back to global config when no channel default", async () => {
    getChannelConfigMock.mockReturnValue(null);

    const { getModelForChat, startAgent } = await import("./agent");
    await startAgent();

    expect(getModelForChat(-200002)).toBe("gpt-4.1");
  });

  it("refreshes active default sessions when the default provider changes", async () => {
    const session = {
      sessionId: "session-default-provider",
      setModel: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock.mockResolvedValue(session);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);

    const { config } = await import("./config.js");
    config.providers.anthropicApiKey = "sk-ant-test";

    const { createNewSession, getSessionForChat, startAgent, switchDefaultModel } =
      await import("./agent");

    await startAgent();
    await createNewSession({ chatId: -200005 });
    await switchDefaultModel("anthropic:claude-opus-4-6");

    expect(session.setModel).not.toHaveBeenCalled();
    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(deleteSessionMock).toHaveBeenCalledWith("session-default-provider");
    expect(getSessionForChat(-200005)).toBeUndefined();
  });

  it("switches active default sessions in place when the provider stays the same", async () => {
    const session = {
      sessionId: "session-default-model",
      setModel: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock.mockResolvedValue(session);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);

    const { createNewSession, startAgent, switchDefaultModel } = await import("./agent");

    await startAgent();
    await createNewSession({ chatId: -200006 });
    await switchDefaultModel("gpt-5.4");

    expect(session.setModel).toHaveBeenCalledWith("gpt-5.4");
    expect(session.disconnect).not.toHaveBeenCalled();
  });

  it("skips active sessions that inherit a channel default model", async () => {
    const session = {
      sessionId: "session-channel-default",
      setModel: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock.mockResolvedValue(session);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);
    getChannelConfigMock.mockReturnValue({ defaultModel: "gpt-4.1" });

    const { createNewSession, getSessionForChat, startAgent, switchDefaultModel } =
      await import("./agent");

    await startAgent();
    await createNewSession({ chatId: -200007 });
    await switchDefaultModel("anthropic:claude-opus-4-6");

    expect(session.setModel).not.toHaveBeenCalled();
    expect(session.disconnect).not.toHaveBeenCalled();
    expect(deleteSessionMock).not.toHaveBeenCalledWith("session-channel-default");
    expect(getSessionForChat(-200007)).toBe(session);
  });
});

describe("getReasoningEffortForChat", () => {
  it("uses per-chat override over channel default", async () => {
    getChannelConfigMock.mockReturnValue({ defaultReasoningEffort: "low" });

    const { getReasoningEffortForChat, setReasoningEffort, startAgent } = await import("./agent");
    await startAgent();
    await setReasoningEffort(-100123, "high");

    expect(getReasoningEffortForChat(-100123)).toBe("high");
  });

  it("falls back to channel default when no per-chat override", async () => {
    getChannelConfigMock.mockReturnValue({ defaultReasoningEffort: "medium" });

    const { getReasoningEffortForChat, startAgent } = await import("./agent");
    await startAgent();

    expect(getReasoningEffortForChat(-200003)).toBe("medium");
  });

  it("returns undefined when no reasoning set anywhere", async () => {
    getChannelConfigMock.mockReturnValue(null);

    const { getReasoningEffortForChat, startAgent } = await import("./agent");
    await startAgent();

    expect(getReasoningEffortForChat(-200004)).toBeUndefined();
  });
});
