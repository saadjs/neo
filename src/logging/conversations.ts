import Database from "better-sqlite3";
import { join } from "node:path";
import { config } from "../config.js";
import { getLogger } from "./index.js";

let db: Database.Database | null = null;

export function getConversationDb(): Database.Database {
  if (db) return db;

  const dbPath = join(config.paths.data, "conversations.db");
  db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = normal");

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

const stmtCache = new Map<string, Database.Statement>();

function stmt(sql: string): Database.Statement {
  let s = stmtCache.get(sql);
  if (!s) {
    s = getConversationDb().prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

export function logSession(sessionId: string, chatId: number, model: string): void {
  stmt("INSERT OR IGNORE INTO sessions (id, chat_id, model) VALUES (?, ?, ?)").run(
    sessionId,
    chatId,
    model,
  );
}

export function logMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string,
  eventId?: string,
): void {
  stmt("INSERT INTO messages (session_id, role, content, event_id) VALUES (?, ?, ?, ?)").run(
    sessionId,
    role,
    content,
    eventId ?? null,
  );
}

export function logToolCall(
  sessionId: string,
  toolCallId: string,
  toolName: string,
  args: unknown,
): void {
  stmt(
    "INSERT INTO tool_calls (session_id, tool_call_id, tool_name, arguments) VALUES (?, ?, ?, ?)",
  ).run(sessionId, toolCallId, toolName, typeof args === "string" ? args : JSON.stringify(args));
}

export function completeToolCall(
  toolCallId: string,
  result: unknown,
  success: boolean,
  durationMs?: number,
): void {
  const resultStr = typeof result === "string" ? result : JSON.stringify(result);
  stmt("UPDATE tool_calls SET result = ?, success = ?, duration_ms = ? WHERE tool_call_id = ?").run(
    resultStr,
    success ? 1 : 0,
    durationMs ?? null,
    toolCallId,
  );
}

export function closeConversationDb(): void {
  if (db) {
    stmtCache.clear();
    db.close();
    db = null;
  }
}
