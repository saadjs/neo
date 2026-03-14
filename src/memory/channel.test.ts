import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";

// Inline the full schema including channel_config and chat_id column
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS memory_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    date TEXT,
    content TEXT NOT NULL,
    chat_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_memory_source ON memory_entries(source);
  CREATE INDEX IF NOT EXISTS idx_memory_date ON memory_entries(date);
  CREATE INDEX IF NOT EXISTS idx_memory_chat_id ON memory_entries(chat_id);
  CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
    USING fts5(content, content_rowid='id', tokenize='unicode61');
  CREATE TRIGGER IF NOT EXISTS memory_entries_ai AFTER INSERT ON memory_entries BEGIN
    INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS memory_entries_ad AFTER DELETE ON memory_entries BEGIN
    DELETE FROM memory_fts WHERE rowid = old.id;
  END;
  CREATE TABLE IF NOT EXISTS channel_config (
    chat_id INTEGER PRIMARY KEY,
    label TEXT,
    soul_overlay TEXT,
    preferences TEXT,
    topics TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  return db;
}

function insertEntry(
  db: DatabaseSync,
  source: string,
  content: string,
  date?: string,
  chatId?: number,
) {
  db.prepare("INSERT INTO memory_entries (source, content, date, chat_id) VALUES (?, ?, ?, ?)").run(
    source,
    content,
    date ?? null,
    chatId ?? null,
  );
}

function searchFts(db: DatabaseSync, query: string, limit = 20, chatId?: number) {
  const sanitized = `"${query.replace(/"/g, '""')}"`;
  if (chatId != null) {
    return db
      .prepare(
        `SELECT me.source, me.date,
                snippet(memory_fts, 0, '>>>', '<<<', '...', 48) AS snippet
         FROM memory_fts
         JOIN memory_entries me ON me.id = memory_fts.rowid
         WHERE memory_fts MATCH ?
           AND (me.chat_id IS NULL OR me.chat_id = ?)
         ORDER BY bm25(memory_fts)
         LIMIT ?`,
      )
      .all(sanitized, chatId, limit) as { source: string; date: string | null; snippet: string }[];
  }
  return db
    .prepare(
      `SELECT me.source, me.date,
              snippet(memory_fts, 0, '>>>', '<<<', '...', 48) AS snippet
       FROM memory_fts
       JOIN memory_entries me ON me.id = memory_fts.rowid
       WHERE memory_fts MATCH ?
         AND me.chat_id IS NULL
       ORDER BY bm25(memory_fts)
       LIMIT ?`,
    )
    .all(sanitized, limit) as { source: string; date: string | null; snippet: string }[];
}

describe("channel-scoped memory", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  describe("memory isolation", () => {
    it("channel-scoped entries are not returned in global search", () => {
      insertEntry(db, "daily", "Global note about testing", "2026-03-13");
      insertEntry(db, "daily", "Channel note about deployment", "2026-03-13", -100123);

      // Global search without chatId returns only unscoped entries
      const allResults = searchFts(db, "note");
      expect(allResults).toHaveLength(1);
      expect(allResults[0].source).toBe("daily");
      expect(allResults[0].date).toBe("2026-03-13");

      // Search scoped to channel returns channel + global entries
      const channelResults = searchFts(db, "note", 20, -100123);
      expect(channelResults).toHaveLength(2);

      // Search scoped to a different channel only returns global entries
      const otherResults = searchFts(db, "deployment", 20, -999);
      expect(otherResults).toHaveLength(0);
    });

    it("global entries are always visible to channel-scoped search", () => {
      insertEntry(db, "human", "User prefers dark mode");
      insertEntry(db, "daily", "Channel-specific discussion", "2026-03-13", -100123);

      const results = searchFts(db, "dark mode", 20, -100123);
      expect(results).toHaveLength(1);
      expect(results[0].source).toBe("human");
    });
  });

  describe("channel_config CRUD", () => {
    it("insert and retrieve channel config", () => {
      db.prepare("INSERT INTO channel_config (chat_id, label, topics) VALUES (?, ?, ?)").run(
        -100123,
        "coding",
        "programming, devops",
      );

      const row = db
        .prepare("SELECT * FROM channel_config WHERE chat_id = ?")
        .get(-100123) as Record<string, unknown>;

      expect(row.chat_id).toBe(-100123);
      expect(row.label).toBe("coding");
      expect(row.topics).toBe("programming, devops");
      expect(row.soul_overlay).toBeNull();
      expect(row.preferences).toBeNull();
    });

    it("upsert updates existing config", () => {
      db.prepare("INSERT INTO channel_config (chat_id, label) VALUES (?, ?)").run(
        -100123,
        "old-label",
      );

      db.prepare(
        "UPDATE channel_config SET label = ?, updated_at = datetime('now') WHERE chat_id = ?",
      ).run("new-label", -100123);

      const row = db.prepare("SELECT label FROM channel_config WHERE chat_id = ?").get(-100123) as {
        label: string;
      };
      expect(row.label).toBe("new-label");
    });

    it("multiple channels are independent", () => {
      db.prepare("INSERT INTO channel_config (chat_id, label, topics) VALUES (?, ?, ?)").run(
        -100,
        "coding",
        "programming",
      );
      db.prepare("INSERT INTO channel_config (chat_id, label, topics) VALUES (?, ?, ?)").run(
        -200,
        "personal",
        "life, hobbies",
      );

      const rows = db
        .prepare("SELECT chat_id, label, topics FROM channel_config ORDER BY chat_id")
        .all() as { chat_id: number; label: string; topics: string }[];

      expect(rows).toHaveLength(2);
      expect(rows[0].chat_id).toBe(-200);
      expect(rows[0].label).toBe("personal");
      expect(rows[1].chat_id).toBe(-100);
      expect(rows[1].label).toBe("coding");
    });
  });

  describe("replaceMemorySource with chatId scoping", () => {
    it("only deletes entries for the specified channel", () => {
      insertEntry(db, "daily", "Global entry", "2026-03-13");
      insertEntry(db, "daily", "Channel entry", "2026-03-13", -100123);
      insertEntry(db, "daily", "Other channel entry", "2026-03-13", -999);

      // Delete channel -100123 daily entries
      db.prepare("DELETE FROM memory_entries WHERE source = ? AND chat_id = ?").run(
        "daily",
        -100123,
      );

      const remaining = db
        .prepare("SELECT content, chat_id FROM memory_entries ORDER BY id")
        .all() as { content: string; chat_id: number | null }[];

      expect(remaining).toHaveLength(2);
      expect(remaining[0].content).toBe("Global entry");
      expect(remaining[0].chat_id).toBeNull();
      expect(remaining[1].content).toBe("Other channel entry");
      expect(remaining[1].chat_id).toBe(-999);
    });
  });
});
