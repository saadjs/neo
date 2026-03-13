import { CopilotClient, CopilotSession, approveAll } from "@github/copilot-sdk";
import { config } from "./config.js";
import { allTools } from "./tools/index.js";
import { buildSystemContext } from "./memory/index.js";
import { getLogger } from "./logging/index.js";
import { getActiveSessionId, logSession, setActiveSession } from "./logging/conversations.js";

let client: CopilotClient | null = null;
const sessions = new Map<number, CopilotSession>();
const sessionModels = new Map<number, string>();

export async function startAgent(): Promise<CopilotClient> {
  const log = getLogger();
  log.info("Starting Copilot SDK client...");

  client = new CopilotClient({
    githubToken: config.github.token,
  });

  await client.start();
  log.info("Copilot SDK client started");
  return client;
}

export async function stopAgent(): Promise<void> {
  const log = getLogger();

  for (const [chatId, session] of sessions) {
    try {
      await session.disconnect();
    } catch (err) {
      log.warn({ chatId, err }, "Error disconnecting session");
    }
  }
  sessions.clear();

  if (client) {
    await client.stop();
    client = null;
    log.info("Copilot SDK client stopped");
  }
}

export interface CreateSessionOptions {
  chatId: number;
}

export async function getOrCreateSession(opts: CreateSessionOptions): Promise<CopilotSession> {
  const existing = sessions.get(opts.chatId);
  if (existing) return existing;

  const previousSessionId = getActiveSessionId(opts.chatId);
  if (previousSessionId && client) {
    try {
      const resumed = await client.resumeSession(
        previousSessionId,
        await buildSessionConfig(opts.chatId),
      );
      sessions.set(opts.chatId, resumed);
      setActiveSession(opts.chatId, resumed.sessionId);
      getLogger().info(
        { chatId: opts.chatId, sessionId: resumed.sessionId },
        "Resumed Copilot session",
      );
      return resumed;
    } catch (err) {
      getLogger().warn(
        { chatId: opts.chatId, sessionId: previousSessionId, err },
        "Failed to resume session, creating a new one",
      );
    }
  }

  return createNewSession(opts);
}

export async function createNewSession(opts: CreateSessionOptions): Promise<CopilotSession> {
  if (!client) throw new Error("Agent not started");
  const log = getLogger();

  // Destroy existing session for this chat
  const existing = sessions.get(opts.chatId);
  if (existing) {
    try {
      await existing.destroy();
    } catch {
      // ignore
    }
    sessions.delete(opts.chatId);
  }

  const model = sessionModels.get(opts.chatId) ?? config.copilot.model;

  log.info({ chatId: opts.chatId, model }, "Creating new Copilot session");

  const session = await client.createSession(await buildSessionConfig(opts.chatId));

  sessions.set(opts.chatId, session);
  log.info({ chatId: opts.chatId, sessionId: session.sessionId }, "Session created");

  try {
    logSession(session.sessionId, opts.chatId, model);
  } catch {}
  try {
    setActiveSession(opts.chatId, session.sessionId);
  } catch {}

  return session;
}

export async function switchModel(chatId: number, model: string): Promise<void> {
  sessionModels.set(chatId, model);
  const session = sessions.get(chatId);
  if (session) {
    await session.setModel(model);
    getLogger().info({ chatId, model }, "Model switched");
  }
}

export async function destroySession(chatId: number): Promise<void> {
  const session = sessions.get(chatId);
  if (session) {
    try {
      await session.destroy();
    } catch {
      // ignore
    }
    sessions.delete(chatId);
  }
}

export function getSessionForChat(chatId: number): CopilotSession | undefined {
  return sessions.get(chatId);
}

export function listActiveSessions(): { chatId: number; sessionId: string }[] {
  return Array.from(sessions.entries()).map(([chatId, session]) => ({
    chatId,
    sessionId: session.sessionId,
  }));
}

export function getClient(): CopilotClient | null {
  return client;
}

export function getChatIdForSession(sessionId: string): number | undefined {
  for (const [chatId, session] of sessions) {
    if (session.sessionId === sessionId) return chatId;
  }
  return undefined;
}

export function getModelForChat(chatId: number): string {
  return sessionModels.get(chatId) ?? config.copilot.model;
}

async function buildSessionConfig(chatId: number) {
  const systemContext = await buildSystemContext();
  const model = sessionModels.get(chatId) ?? config.copilot.model;

  return {
    clientName: "neo",
    model,
    systemMessage: { mode: "replace" as const, content: systemContext },
    tools: allTools,
    skillDirectories: config.copilot.skillDirectories,
    onPermissionRequest: approveAll,
    workingDirectory: config.paths.root,
    infiniteSessions: {
      enabled: config.copilot.contextCompaction.enabled,
      backgroundCompactionThreshold: config.copilot.contextCompaction.threshold,
      bufferExhaustionThreshold: config.copilot.contextCompaction.bufferExhaustionThreshold,
    },
  };
}
