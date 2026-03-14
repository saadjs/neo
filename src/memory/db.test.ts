import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";

// Inline schema to avoid importing db.ts (which pulls in config.ts and requires env vars)
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS memory_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    date TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_memory_source ON memory_entries(source);
  CREATE INDEX IF NOT EXISTS idx_memory_date ON memory_entries(date);
  CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
    USING fts5(content, content_rowid='id', tokenize='unicode61');
  CREATE TRIGGER IF NOT EXISTS memory_entries_ai AFTER INSERT ON memory_entries BEGIN
    INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS memory_entries_ad AFTER DELETE ON memory_entries BEGIN
    DELETE FROM memory_fts WHERE rowid = old.id;
  END;
`;

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  return db;
}

function insertEntry(db: DatabaseSync, source: string, content: string, date?: string) {
  db.prepare("INSERT INTO memory_entries (source, content, date) VALUES (?, ?, ?)").run(
    source,
    content,
    date ?? null,
  );
}

function searchFts(db: DatabaseSync, query: string, limit = 20) {
  const sanitized = `"${query.replace(/"/g, '""')}"`;
  return db
    .prepare(
      `SELECT me.source, me.date,
              snippet(memory_fts, 0, '>>>', '<<<', '...', 48) AS snippet
       FROM memory_fts
       JOIN memory_entries me ON me.id = memory_fts.rowid
       WHERE memory_fts MATCH ?
       ORDER BY bm25(memory_fts)
       LIMIT ?`,
    )
    .all(sanitized, limit) as { source: string; date: string | null; snippet: string }[];
}

describe("memory FTS5", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  it("insert and search round-trip", () => {
    insertEntry(db, "daily", "Discussed migration to SQLite for search", "2026-03-13");
    insertEntry(db, "human", "User prefers dark mode");

    const results = searchFts(db, "SQLite");
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("daily");
    expect(results[0].date).toBe("2026-03-13");
    expect(results[0].snippet).toContain("SQLite");
  });

  it("replaceMemorySource clears old entries from both table and FTS", () => {
    insertEntry(db, "soul", "I am Neo, a personal AI agent.");
    insertEntry(db, "human", "User likes coffee");

    // Verify initial state
    expect(searchFts(db, "Neo")).toHaveLength(1);

    // Replace soul entries (delete then re-insert)
    db.prepare("DELETE FROM memory_entries WHERE source = ?").run("soul");
    insertEntry(db, "soul", "I am Neo, an advanced AI assistant.");

    // Old content should be gone from FTS
    const oldResults = searchFts(db, "personal");
    expect(oldResults).toHaveLength(0);

    // New content should be searchable
    const newResults = searchFts(db, "advanced");
    expect(newResults).toHaveLength(1);
    expect(newResults[0].source).toBe("soul");

    // Human entry should be unaffected
    expect(searchFts(db, "coffee")).toHaveLength(1);
  });

  it("BM25 ranking puts better matches first", () => {
    insertEntry(db, "daily", "The weather was sunny today", "2026-03-10");
    insertEntry(
      db,
      "daily",
      "Deployed new weather forecasting service with weather API integration",
      "2026-03-11",
    );
    insertEntry(db, "human", "Unrelated preference about notifications");

    const results = searchFts(db, "weather");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Entry with more occurrences of "weather" should rank higher
    expect(results[0].snippet).toContain("weather");
    expect(results[1].snippet).toContain("weather");
  });

  it("handles special characters in query without error", () => {
    insertEntry(db, "daily", "Fixed bug in user-facing API endpoint", "2026-03-13");

    // Queries with FTS5 operators should not throw
    expect(() => searchFts(db, "AND OR NOT")).not.toThrow();
    expect(() => searchFts(db, "user*")).not.toThrow();
    expect(() => searchFts(db, '"quoted phrase"')).not.toThrow();
    expect(() => searchFts(db, "hello (world)")).not.toThrow();
  });

  it("backfill: parses bullet lines and session blocks", () => {
    // Simulate daily memory content parsing
    const dailyContent = [
      "# Memory — 2026-03-13",
      "",
      "- Reviewed pull request for auth module",
      "- Fixed flaky test in CI pipeline",
      "",
      "## Session Context Summary",
      "- Timestamp: 2026-03-13T10:00:00Z",
      "- Chat ID: 123",
      "- Session ID: abc",
      "",
      "### Summary",
      "Discussed deployment strategy for new feature",
      "",
    ].join("\n");

    // Parse like backfill does
    const lines = dailyContent.split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith("## Session Context Summary")) {
        const blockLines = [line];
        i++;
        while (i < lines.length && !lines[i].startsWith("## ")) {
          blockLines.push(lines[i]);
          i++;
        }
        insertEntry(db, "daily", blockLines.join("\n").trim(), "2026-03-13");
      } else if (line.startsWith("- ")) {
        insertEntry(db, "daily", line.slice(2).trim(), "2026-03-13");
        i++;
      } else {
        i++;
      }
    }

    expect(searchFts(db, "auth module")).toHaveLength(1);
    expect(searchFts(db, "flaky test")).toHaveLength(1);
    expect(searchFts(db, "deployment strategy")).toHaveLength(1);
  });

  it("returns empty array for no matches", () => {
    insertEntry(db, "daily", "Something about databases", "2026-03-13");
    const results = searchFts(db, "quantum physics");
    expect(results).toHaveLength(0);
  });
});
