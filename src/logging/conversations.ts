import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { config } from "../config.js";
import { getLogger } from "./index.js";

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
      chat_id INTEGER NOT NULL,
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

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_chat ON sessions(chat_id);
  `);

  getLogger().info({ dbPath }, "Conversation database initialized");
  return db;
}

export function logSession(sessionId: string, chatId: number, model: string): void {
  getConversationDb()
    .prepare("INSERT OR IGNORE INTO sessions (id, chat_id, model) VALUES (?, ?, ?)")
    .run(sessionId, chatId, model);
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

export function closeConversationDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
