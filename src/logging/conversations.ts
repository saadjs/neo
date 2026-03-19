import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { config } from "../config";
import { getLogger } from "./index";
import { initTokenUsageTable } from "./cost";

let db: DatabaseSync | null = null;

export function getConversationDb(): DatabaseSync {
  if (db) return db;

  const dbPath = join(config.paths.data, "conversations.db");
  db = new DatabaseSync(dbPath);

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = normal");

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      event_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      tool_call_id TEXT,
      tool_name TEXT NOT NULL,
      arguments TEXT,
      result TEXT,
      success INTEGER,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_session_state (
      chat_id TEXT PRIMARY KEY,
      current_session_id TEXT NOT NULL,
      last_compaction_event_id TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_chat ON sessions(chat_id);
  `);

  // FTS5 full-text search index on message content
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
      USING fts5(content, content_rowid='id', tokenize='unicode61');

    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
  `);

  // Backfill existing messages into FTS (idempotent)
  db.exec(`
    INSERT INTO messages_fts(rowid, content)
      SELECT id, content FROM messages
      WHERE id NOT IN (SELECT rowid FROM messages_fts);
  `);

  try {
    db.exec("ALTER TABLE sessions ADD COLUMN tags TEXT");
  } catch {
    // Column already exists — ignore
  }

  initTokenUsageTable();

  getLogger().info({ dbPath }, "Conversation database initialized");
  return db;
}

export function logSession(sessionId: string, chatId: string, model: string): void {
  getConversationDb()
    .prepare("INSERT OR IGNORE INTO sessions (id, chat_id, model) VALUES (?, ?, ?)")
    .run(sessionId, chatId, model);
}

export function setActiveSession(chatId: string, sessionId: string): void {
  getConversationDb()
    .prepare(
      `INSERT INTO chat_session_state (chat_id, current_session_id, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(chat_id) DO UPDATE SET
         current_session_id = excluded.current_session_id,
         updated_at = datetime('now')`,
    )
    .run(chatId, sessionId);
}

export function getActiveSessionId(chatId: string): string | undefined {
  const row = getConversationDb()
    .prepare("SELECT current_session_id FROM chat_session_state WHERE chat_id = ?")
    .get(chatId) as { current_session_id?: string } | undefined;
  return row?.current_session_id || undefined;
}

export function clearActiveSession(chatId: string): void {
  getConversationDb()
    .prepare(
      `INSERT INTO chat_session_state (chat_id, current_session_id, updated_at)
       VALUES (?, '', datetime('now'))
       ON CONFLICT(chat_id) DO UPDATE SET
         current_session_id = '',
         updated_at = datetime('now')`,
    )
    .run(chatId);
}

export function getLastCompactionEventId(chatId: string): string | undefined {
  const row = getConversationDb()
    .prepare("SELECT last_compaction_event_id FROM chat_session_state WHERE chat_id = ?")
    .get(chatId) as { last_compaction_event_id?: string | null } | undefined;
  return row?.last_compaction_event_id ?? undefined;
}

export function setLastCompactionEventId(chatId: string, eventId: string): void {
  getConversationDb()
    .prepare(
      `UPDATE chat_session_state
       SET last_compaction_event_id = ?, updated_at = datetime('now')
       WHERE chat_id = ?`,
    )
    .run(eventId, chatId);
}

export function logMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string,
  eventId?: string,
): void {
  getConversationDb()
    .prepare("INSERT INTO messages (session_id, role, content, event_id) VALUES (?, ?, ?, ?)")
    .run(sessionId, role, content, eventId ?? null);
}

export function logToolCall(
  sessionId: string,
  toolCallId: string,
  toolName: string,
  args: unknown,
): void {
  getConversationDb()
    .prepare(
      "INSERT INTO tool_calls (session_id, tool_call_id, tool_name, arguments) VALUES (?, ?, ?, ?)",
    )
    .run(sessionId, toolCallId, toolName, typeof args === "string" ? args : JSON.stringify(args));
}

export function completeToolCall(
  toolCallId: string,
  result: unknown,
  success: boolean,
  durationMs?: number,
): void {
  const resultStr = typeof result === "string" ? result : JSON.stringify(result);
  getConversationDb()
    .prepare(
      "UPDATE tool_calls SET result = ?, success = ?, duration_ms = ? WHERE tool_call_id = ?",
    )
    .run(resultStr, success ? 1 : 0, durationMs ?? null, toolCallId);
}

export interface SearchResult {
  id: number;
  role: string;
  content: string;
  created_at: string;
  session_id: string;
  snippet: string;
}

export function searchMessages(query: string, limit = 20, offset = 0): SearchResult[] {
  return getConversationDb()
    .prepare(
      `SELECT m.id, m.role, m.content, m.created_at, m.session_id,
              snippet(messages_fts, 0, '>>>', '<<<', '...', 48) AS snippet
       FROM messages_fts
       JOIN messages m ON m.id = messages_fts.rowid
       WHERE messages_fts MATCH ?
       ORDER BY bm25(messages_fts)
       LIMIT ? OFFSET ?`,
    )
    .all(query, limit, offset) as unknown as SearchResult[];
}

export interface HistoryMessage {
  role: string;
  content: string;
  created_at: string;
  session_id: string;
}

export function getRecentHistory(chatId: string, limit = 20): HistoryMessage[] {
  return getConversationDb()
    .prepare(
      `SELECT m.role, m.content, m.created_at, m.session_id
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE s.chat_id = ?
       ORDER BY m.created_at DESC
       LIMIT ?`,
    )
    .all(chatId, limit) as unknown as HistoryMessage[];
}

export function setSessionTags(sessionId: string, tags: string[]): void {
  getConversationDb()
    .prepare("UPDATE sessions SET tags = ? WHERE id = ?")
    .run(tags.join(","), sessionId);
}

export function getSessionTags(sessionId: string): string[] {
  const row = getConversationDb()
    .prepare("SELECT tags FROM sessions WHERE id = ?")
    .get(sessionId) as { tags?: string | null } | undefined;
  if (!row?.tags) return [];
  return row.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function searchSessionsByTag(
  tag: string,
  limit = 20,
): Array<{ id: string; chat_id: string; model: string; tags: string; created_at: string }> {
  return getConversationDb()
    .prepare(
      `SELECT id, chat_id, model, tags, created_at FROM sessions
       WHERE tags LIKE ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(`%${tag}%`, limit) as unknown as Array<{
    id: string;
    chat_id: string;
    model: string;
    tags: string;
    created_at: string;
  }>;
}

export function closeConversationDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
