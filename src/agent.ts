import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CopilotClient, CopilotSession, approveAll } from "@github/copilot-sdk";
import type { SessionMetadata } from "@github/copilot-sdk";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
import { config } from "./config";
import { allTools } from "./tools/index";
import { buildSystemContext } from "./memory/index";
import { getLogger } from "./logging/index";
import { buildSessionHooks } from "./hooks/index";
import {
  cancelAllPendingUserInputs,
  cancelPendingUserInput,
  requestUserInput,
} from "./telegram/user-input";
import { clearActiveSession, getActiveSessionId } from "./logging/conversations";
import { VALID_REASONING_EFFORTS } from "./constants";
import { getChannelConfig } from "./memory/db";

let client: CopilotClient | null = null;
const sessions = new Map<number, CopilotSession>();
const sessionModels = new Map<number, string>();
const activeSessionTurns = new Map<number, number>();
const staleSessions = new Map<number, Set<CopilotSession>>();
const abortedChats = new Set<number>();
const SESSION_MODEL_OVERRIDES_FILE = join(config.paths.data, "session-model-overrides.json");
const sessionReasoningEfforts = new Map<number, ReasoningEffort>();
const SESSION_REASONING_OVERRIDES_FILE = join(
  config.paths.data,
  "session-reasoning-overrides.json",
);
async function loadSessionModelOverrides(): Promise<void> {
  try {
    const raw = await readFile(SESSION_MODEL_OVERRIDES_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }

    sessionModels.clear();
    for (const [chatId, model] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof model !== "string" || !model.trim()) continue;
      const numericChatId = Number(chatId);
      if (!Number.isInteger(numericChatId)) continue;
      sessionModels.set(numericChatId, model.trim());
    }
  } catch {
    // no persisted overrides yet
  }
}

async function persistSessionModelOverrides(): Promise<void> {
  const payload: Record<string, string> = {};
  for (const [chatId, model] of sessionModels) {
    payload[String(chatId)] = model;
  }

  await mkdir(dirname(SESSION_MODEL_OVERRIDES_FILE), { recursive: true });
  await writeFile(SESSION_MODEL_OVERRIDES_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

async function loadSessionReasoningOverrides(): Promise<void> {
  try {
    const raw = await readFile(SESSION_REASONING_OVERRIDES_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }

    sessionReasoningEfforts.clear();
    for (const [chatId, effort] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof effort !== "string" || !VALID_REASONING_EFFORTS.has(effort)) continue;
      const numericChatId = Number(chatId);
      if (!Number.isInteger(numericChatId)) continue;
      sessionReasoningEfforts.set(numericChatId, effort as ReasoningEffort);
    }
  } catch {
    // no persisted overrides yet
  }
}

async function persistSessionReasoningOverrides(): Promise<void> {
  const payload: Record<string, string> = {};
  for (const [chatId, effort] of sessionReasoningEfforts) {
    payload[String(chatId)] = effort;
  }

  await mkdir(dirname(SESSION_REASONING_OVERRIDES_FILE), { recursive: true });
  await writeFile(
    SESSION_REASONING_OVERRIDES_FILE,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf-8",
  );
}

export async function startAgent(): Promise<CopilotClient> {
  const log = getLogger();
  log.info("Starting Copilot SDK client...");

  client = new CopilotClient({
    githubToken: config.github.token,
  });

  await client.start();
  await loadSessionModelOverrides();
  await loadSessionReasoningOverrides();
  log.info({ overrides: sessionModels.size }, "Copilot SDK client started");
  return client;
}

export async function stopAgent(): Promise<void> {
  const log = getLogger();

  await cancelAllPendingUserInputs(
    "Task interrupted while waiting for your answer. Please retry after Neo is back online.",
    { notifyUser: true },
  );

  for (const [chatId, session] of sessions) {
    try {
      await session.disconnect();
    } catch (err) {
      log.warn({ chatId, err }, "Error disconnecting session");
    }
  }
  sessions.clear();

  for (const [chatId, sessionsForChat] of staleSessions) {
    for (const session of sessionsForChat) {
      const staleId = session.sessionId;
      try {
        await session.disconnect();
      } catch (err) {
        log.warn({ chatId, err }, "Error disconnecting stale session");
      }
      try {
        await client?.deleteSession(staleId);
      } catch (err) {
        log.warn({ chatId, err }, "Error deleting stale session from disk");
      }
    }
  }
  staleSessions.clear();
  activeSessionTurns.clear();

  if (client) {
    await client.stop();
    client = null;
    log.info("Copilot SDK client stopped");
  }
}

export interface CreateSessionOptions {
  chatId: number;
}

export interface DestroySessionOptions {
  deletePersisted?: boolean;
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

      const desiredModel = sessionModels.get(opts.chatId) ?? config.copilot.model;
      await resumed.setModel(desiredModel);

      sessions.set(opts.chatId, resumed);
      getLogger().info(
        { chatId: opts.chatId, sessionId: resumed.sessionId, model: desiredModel },
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

  // Replace any cached live session for this chat, but keep its persisted
  // state so it remains resumable from /sessions.
  const existing = sessions.get(opts.chatId);
  if (existing) {
    try {
      await existing.disconnect();
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

  return session;
}

export async function switchModel(chatId: number, model: string): Promise<void> {
  sessionModels.set(chatId, model);
  try {
    await persistSessionModelOverrides();
  } catch (err) {
    getLogger().warn({ chatId, err }, "Failed to persist model overrides");
  }

  const session = sessions.get(chatId);
  if (session) {
    await session.setModel(model);
    getLogger().info({ chatId, model }, "Model switched");
  }
}

export async function switchDefaultModel(model: string): Promise<void> {
  config.copilot.model = model;

  for (const [chatId, session] of sessions) {
    if (sessionModels.has(chatId)) continue;
    await session.setModel(model);
    getLogger().info({ chatId, model }, "Default model applied to active session");
  }
}

export async function destroySession(
  chatId: number,
  opts: DestroySessionOptions = {},
): Promise<void> {
  const { deletePersisted = false } = opts;

  await cancelPendingUserInput(chatId, "Pending question cancelled because the session was reset.");

  try {
    clearActiveSession(chatId);
  } catch {
    // ignore
  }

  const session = sessions.get(chatId);
  if (session) {
    const sessionId = session.sessionId;
    try {
      await session.disconnect();
    } catch {
      // ignore
    }
    if (deletePersisted) {
      try {
        await client?.deleteSession(sessionId);
      } catch {
        // ignore
      }
    }
    sessions.delete(chatId);
  }

  const staleSessionsForChat = staleSessions.get(chatId);
  if (staleSessionsForChat) {
    for (const staleSession of staleSessionsForChat) {
      const staleId = staleSession.sessionId;
      try {
        await staleSession.disconnect();
      } catch {
        // ignore
      }
      if (deletePersisted) {
        try {
          await client?.deleteSession(staleId);
        } catch {
          // ignore
        }
      }
    }
    staleSessions.delete(chatId);
  }
}

export function getSessionForChat(chatId: number): CopilotSession | undefined {
  return sessions.get(chatId);
}

export function hasTrackedSession(chatId: number, session: CopilotSession): boolean {
  if (sessions.get(chatId) === session) {
    return true;
  }

  return staleSessions.get(chatId)?.has(session) ?? false;
}

export function discardSession(chatId: number, session: CopilotSession): void {
  const activeSession = sessions.get(chatId);
  if (activeSession === session) {
    sessions.delete(chatId);
    try {
      clearActiveSession(chatId);
    } catch {
      // ignore
    }
  }

  const staleSessionsForChat = staleSessions.get(chatId);
  if (!staleSessionsForChat) return;

  staleSessionsForChat.delete(session);
  if (staleSessionsForChat.size === 0) {
    staleSessions.delete(chatId);
  }
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
  for (const [chatId, sessionsForChat] of staleSessions) {
    for (const session of sessionsForChat) {
      if (session.sessionId === sessionId) return chatId;
    }
  }
  return undefined;
}

export async function abortSession(
  chatId: number,
): Promise<"aborted" | "no-session" | "no-active-turn"> {
  const session = sessions.get(chatId);
  if (!session) return "no-session";
  if ((activeSessionTurns.get(chatId) ?? 0) === 0) return "no-active-turn";

  abortedChats.add(chatId);
  await session.abort();
  return "aborted";
}

export function consumeAbortFlag(chatId: number): boolean {
  return abortedChats.delete(chatId);
}

export function getModelForChat(chatId: number): string {
  return (
    sessionModels.get(chatId) ?? getChannelConfig(chatId)?.defaultModel ?? config.copilot.model
  );
}

export function getReasoningEffortForChat(chatId: number): ReasoningEffort | undefined {
  const effort =
    sessionReasoningEfforts.get(chatId) ??
    getChannelConfig(chatId)?.defaultReasoningEffort ??
    undefined;
  return effort as ReasoningEffort | undefined;
}

export async function setReasoningEffort(chatId: number, effort: ReasoningEffort): Promise<void> {
  sessionReasoningEfforts.set(chatId, effort);
  try {
    await persistSessionReasoningOverrides();
  } catch (err) {
    getLogger().warn({ chatId, err }, "Failed to persist reasoning effort overrides");
  }
  await refreshSessionContext(chatId);
}

export async function clearReasoningEffort(chatId: number): Promise<void> {
  if (!sessionReasoningEfforts.has(chatId)) return;
  sessionReasoningEfforts.delete(chatId);
  try {
    await persistSessionReasoningOverrides();
  } catch (err) {
    getLogger().warn({ chatId, err }, "Failed to persist reasoning effort overrides");
  }
  await refreshSessionContext(chatId);
}

export function beginSessionTurn(chatId: number): void {
  activeSessionTurns.set(chatId, (activeSessionTurns.get(chatId) ?? 0) + 1);
}

export async function endSessionTurn(chatId: number): Promise<void> {
  const nextCount = (activeSessionTurns.get(chatId) ?? 0) - 1;
  if (nextCount > 0) {
    activeSessionTurns.set(chatId, nextCount);
    return;
  }

  activeSessionTurns.delete(chatId);

  const staleSessionsForChat = staleSessions.get(chatId);
  if (!staleSessionsForChat) return;

  staleSessions.delete(chatId);

  for (const staleSession of staleSessionsForChat) {
    const staleId = staleSession.sessionId;
    try {
      await staleSession.disconnect();
    } catch {
      // ignore
    }
    try {
      await client?.deleteSession(staleId);
    } catch {
      // ignore
    }
  }
}

/**
 * Mark the session for context refresh. The updated system context will take
 * effect when the current turn finishes and /new creates a fresh session, or
 * on the next message if no session exists yet. We intentionally do NOT
 * destroy the active session here — doing so mid-turn would kill the
 * in-flight sendAndWait call in handleMessage.
 */
export async function refreshSessionContext(chatId: number): Promise<void> {
  await cancelPendingUserInput(
    chatId,
    "Pending question cancelled because the session context changed. Please ask again.",
  );

  try {
    clearActiveSession(chatId);
  } catch {
    // ignore
  }

  const session = sessions.get(chatId);
  if (!session) return;

  if ((activeSessionTurns.get(chatId) ?? 0) > 0) {
    sessions.delete(chatId);
    const sessionsForChat = staleSessions.get(chatId) ?? new Set<CopilotSession>();
    sessionsForChat.add(session);
    staleSessions.set(chatId, sessionsForChat);
    return;
  }

  sessions.delete(chatId);

  const sessionId = session.sessionId;
  try {
    await session.disconnect();
  } catch {
    // ignore
  }
  try {
    await client?.deleteSession(sessionId);
  } catch {
    // ignore
  }
}

export async function deletePersistedSession(sessionId: string): Promise<void> {
  if (!client) throw new Error("Agent not started");
  await client.deleteSession(sessionId);
}

export async function listPersistedSessions(): Promise<SessionMetadata[]> {
  if (!client) return [];
  const sessions = await client.listSessions({ cwd: config.paths.root });
  return sessions.sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime());
}

export async function resumeSessionById(
  chatId: number,
  sessionId: string,
): Promise<CopilotSession> {
  if (!client) throw new Error("Agent not started");
  const log = getLogger();

  // Destroy the current session for this chat
  const existing = sessions.get(chatId);
  if (existing) {
    try {
      await existing.disconnect();
    } catch {
      // ignore
    }
    sessions.delete(chatId);
  }

  const resumed = await client.resumeSession(sessionId, await buildSessionConfig(chatId));

  const desiredModel = sessionModels.get(chatId) ?? config.copilot.model;
  await resumed.setModel(desiredModel);

  sessions.set(chatId, resumed);
  log.info({ chatId, sessionId: resumed.sessionId }, "Resumed session via /sessions");

  return resumed;
}

async function buildSessionConfig(chatId: number) {
  const systemContext = await buildSystemContext(chatId);
  const model = getModelForChat(chatId);

  const reasoningEffort = getReasoningEffortForChat(chatId);

  return {
    clientName: "neo",
    model,
    streaming: true,
    ...(reasoningEffort && { reasoningEffort }),
    systemMessage: { mode: "replace" as const, content: systemContext },
    tools: allTools,
    skillDirectories: config.copilot.skillDirectories,
    onPermissionRequest: approveAll,
    onUserInputRequest: async (
      request: { question: string; choices?: string[]; allowFreeform?: boolean },
      invocation: { sessionId: string },
    ) => requestUserInput(chatId, invocation.sessionId, request),
    hooks: buildSessionHooks(chatId),
    workingDirectory: config.paths.root,
    infiniteSessions: {
      enabled: config.copilot.contextCompaction.enabled,
      backgroundCompactionThreshold: config.copilot.contextCompaction.threshold,
      bufferExhaustionThreshold: config.copilot.contextCompaction.bufferExhaustionThreshold,
    },
  };
}
