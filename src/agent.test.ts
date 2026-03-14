import { afterEach, describe, expect, it, vi } from "vitest";

const {
  createSessionMock,
  resumeSessionMock,
  clientStartMock,
  clientStopMock,
  buildSystemContextMock,
  logSessionMock,
  clearActiveSessionMock,
  setActiveSessionMock,
  getActiveSessionIdMock,
  approveAllMock,
} = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  resumeSessionMock: vi.fn(),
  clientStartMock: vi.fn(),
  clientStopMock: vi.fn(),
  buildSystemContextMock: vi.fn(),
  logSessionMock: vi.fn(),
  clearActiveSessionMock: vi.fn(),
  setActiveSessionMock: vi.fn(),
  getActiveSessionIdMock: vi.fn(),
  approveAllMock: vi.fn(),
}));

vi.mock("@github/copilot-sdk", () => ({
  approveAll: approveAllMock,
  CopilotClient: class {
    start = clientStartMock;
    stop = clientStopMock;
    createSession = createSessionMock;
    resumeSession = resumeSessionMock;
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

afterEach(async () => {
  const { stopAgent } = await import("./agent.js");
  await stopAgent();
  vi.resetModules();
  createSessionMock.mockReset();
  resumeSessionMock.mockReset();
  clientStartMock.mockReset();
  clientStopMock.mockReset();
  buildSystemContextMock.mockReset();
  logSessionMock.mockReset();
  clearActiveSessionMock.mockReset();
  setActiveSessionMock.mockReset();
  getActiveSessionIdMock.mockReset();
  approveAllMock.mockReset();
});

describe("refreshSessionContext", () => {
  it("destroys an idle cached session immediately", async () => {
    const session = {
      sessionId: "session-1",
      destroy: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    createSessionMock.mockResolvedValue(session);
    buildSystemContextMock.mockResolvedValue("context");
    getActiveSessionIdMock.mockReturnValue(null);

    const { createNewSession, getSessionForChat, refreshSessionContext, startAgent } =
      await import("./agent.js");

    await startAgent();
    await createNewSession({ chatId: -100123 });
    expect(getSessionForChat(-100123)).toBe(session);

    await refreshSessionContext(-100123);

    expect(clearActiveSessionMock).toHaveBeenCalledWith(-100123);
    expect(session.destroy).toHaveBeenCalledTimes(1);
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
    } = await import("./agent.js");

    await startAgent();
    await createNewSession({ chatId: -100123 });
    beginSessionTurn(-100123);

    await refreshSessionContext(-100123);

    expect(clearActiveSessionMock).toHaveBeenCalledWith(-100123);
    expect(staleSession.destroy).not.toHaveBeenCalled();
    expect(getSessionForChat(-100123)).toBeUndefined();
    expect(getChatIdForSession("session-2")).toBe(-100123);
    await expect(getOrCreateSession({ chatId: -100123 })).resolves.toBe(freshSession);
    expect(getSessionForChat(-100123)).toBe(freshSession);

    await endSessionTurn(-100123);

    expect(staleSession.destroy).toHaveBeenCalledTimes(1);
    expect(freshSession.destroy).not.toHaveBeenCalled();
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
    } = await import("./agent.js");

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
    expect(firstSession.destroy).not.toHaveBeenCalled();
    expect(secondSession.destroy).not.toHaveBeenCalled();

    await endSessionTurn(-100123);
    expect(firstSession.destroy).toHaveBeenCalledTimes(1);
    expect(secondSession.destroy).toHaveBeenCalledTimes(1);
    expect(thirdSession.destroy).not.toHaveBeenCalled();
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
      await import("./agent.js");

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
    } = await import("./agent.js");

    await startAgent();
    await createNewSession({ chatId: -100123 });

    beginSessionTurn(-100123);
    await refreshSessionContext(-100123);

    beginSessionTurn(-100123);
    await expect(getOrCreateSession({ chatId: -100123 })).rejects.toThrow("create failed");

    expect(staleSession.destroy).not.toHaveBeenCalled();

    await endSessionTurn(-100123);
    expect(staleSession.destroy).not.toHaveBeenCalled();

    await endSessionTurn(-100123);
    expect(staleSession.destroy).toHaveBeenCalledTimes(1);
  });
});
