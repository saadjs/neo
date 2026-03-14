import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./conversations.js", () => ({
  getConversationDb: () => {
    throw new Error("should not be called — pass db directly");
  },
}));

import { detectToolAnomalies, formatAnomaliesForContext } from "./anomalies.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    tool_call_id TEXT,
    tool_name TEXT NOT NULL,
    arguments TEXT,
    result TEXT,
    success INTEGER,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  return db;
}

function insertToolCall(
  db: DatabaseSync,
  tool_name: string,
  success: number,
  result?: string,
  created_at?: string,
) {
  db.prepare(
    `INSERT INTO tool_calls (session_id, tool_name, success, result, created_at)
     VALUES ('test-session', ?, ?, ?, ?)`,
  ).run(tool_name, success, result ?? null, created_at ?? new Date().toISOString());
}

describe("detectToolAnomalies", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns empty array when no tool calls exist", () => {
    expect(detectToolAnomalies(db)).toEqual([]);
  });

  it("returns empty array when failures are below threshold", () => {
    insertToolCall(db, "weather", 0, "timeout");
    insertToolCall(db, "weather", 0, "timeout");
    expect(detectToolAnomalies(db)).toEqual([]);
  });

  it("detects 3 consecutive failures", () => {
    insertToolCall(db, "weather", 0, "timeout", "2099-01-01T00:00:00Z");
    insertToolCall(db, "weather", 0, "timeout", "2099-01-01T00:01:00Z");
    insertToolCall(db, "weather", 0, "connection refused", "2099-01-01T00:02:00Z");

    const anomalies = detectToolAnomalies(db);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].tool_name).toBe("weather");
    expect(anomalies[0].consecutive_failures).toBe(3);
    expect(anomalies[0].last_error).toBe("connection refused");
  });

  it("does not flag tool if a success breaks the streak", () => {
    insertToolCall(db, "search", 0, "err", "2099-01-01T00:00:00Z");
    insertToolCall(db, "search", 1, "ok", "2099-01-01T00:01:00Z");
    insertToolCall(db, "search", 0, "err", "2099-01-01T00:02:00Z");
    insertToolCall(db, "search", 0, "err", "2099-01-01T00:03:00Z");

    expect(detectToolAnomalies(db)).toEqual([]);
  });

  it("truncates long error messages to 200 chars", () => {
    const longError = "x".repeat(300);
    insertToolCall(db, "tool1", 0, longError, "2099-01-01T00:00:00Z");
    insertToolCall(db, "tool1", 0, longError, "2099-01-01T00:01:00Z");
    insertToolCall(db, "tool1", 0, longError, "2099-01-01T00:02:00Z");

    const anomalies = detectToolAnomalies(db);
    expect(anomalies[0].last_error).toHaveLength(200);
  });

  it("ignores failures older than 24 hours", () => {
    insertToolCall(db, "old_tool", 0, "err", "2020-01-01T00:00:00Z");
    insertToolCall(db, "old_tool", 0, "err", "2020-01-01T00:01:00Z");
    insertToolCall(db, "old_tool", 0, "err", "2020-01-01T00:02:00Z");

    expect(detectToolAnomalies(db)).toEqual([]);
  });
});

describe("formatAnomaliesForContext", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns empty string when no anomalies", () => {
    expect(formatAnomaliesForContext(db)).toBe("");
  });

  it("formats anomalies as markdown", () => {
    insertToolCall(db, "calendar", 0, "auth expired", "2099-01-01T00:00:00Z");
    insertToolCall(db, "calendar", 0, "auth expired", "2099-01-01T00:01:00Z");
    insertToolCall(db, "calendar", 0, "auth expired", "2099-01-01T00:02:00Z");

    const result = formatAnomaliesForContext(db);
    expect(result).toContain("## ⚠️ Tool Health Alerts");
    expect(result).toContain("**calendar**");
    expect(result).toContain("3 consecutive failures");
    expect(result).toContain("auth expired");
  });
});
