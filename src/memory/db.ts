import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { getLogger } from "../logging/index.js";

let db: DatabaseSync | null = null;
let initialized = false;

export const MEMORY_SCHEMA = `
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

function getMemoryDb(): DatabaseSync {
  if (db) return db;

  const dbPath = join(config.paths.data, "memory.db");
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = normal");
  return db;
}

export function initMemoryTable(): void {
  if (initialized) return;

  const memDb = getMemoryDb();
  memDb.exec(MEMORY_SCHEMA);

  const row = memDb.prepare("SELECT COUNT(*) AS cnt FROM memory_entries").get() as { cnt: number };
  if (row.cnt === 0) {
    backfillFromFiles(memDb).catch((err) => {
      getLogger().error({ err }, "Memory FTS backfill failed");
    });
  }

  initialized = true;
}

export function insertMemoryEntry(source: string, content: string, date?: string): void {
  initMemoryTable();
  try {
    getMemoryDb()
      .prepare("INSERT INTO memory_entries (source, content, date) VALUES (?, ?, ?)")
      .run(source, content, date ?? null);
  } catch (err) {
    getLogger().error({ err }, "Failed to insert memory entry");
  }
}

export function replaceMemorySource(
  source: string,
  entries: { content: string; date?: string }[],
): void {
  initMemoryTable();
  const memDb = getMemoryDb();
  try {
    memDb.exec("BEGIN IMMEDIATE");
    memDb.prepare("DELETE FROM memory_entries WHERE source = ?").run(source);
    const insert = memDb.prepare(
      "INSERT INTO memory_entries (source, content, date) VALUES (?, ?, ?)",
    );
    for (const entry of entries) {
      insert.run(source, entry.content, entry.date ?? null);
    }
    memDb.exec("COMMIT");
  } catch (err) {
    try {
      memDb.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    getLogger().error({ err, source }, "Failed to replace memory source");
  }
}

export interface MemorySearchResult {
  source: string;
  date: string | null;
  snippet: string;
}

export function searchMemoryFts(query: string, limit = 20): MemorySearchResult[] {
  initMemoryTable();
  const sanitized = `"${query.replace(/"/g, '""')}"`;
  try {
    return getMemoryDb()
      .prepare(
        `SELECT me.source, me.date,
                snippet(memory_fts, 0, '>>>', '<<<', '...', 48) AS snippet
         FROM memory_fts
         JOIN memory_entries me ON me.id = memory_fts.rowid
         WHERE memory_fts MATCH ?
         ORDER BY bm25(memory_fts)
         LIMIT ?`,
      )
      .all(sanitized, limit) as unknown as MemorySearchResult[];
  } catch (err) {
    getLogger().error({ err, query }, "Memory FTS search failed");
    return [];
  }
}

function parseBulletLines(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

async function backfillFromFiles(memDb: DatabaseSync): Promise<void> {
  const log = getLogger();
  const insert = memDb.prepare(
    "INSERT INTO memory_entries (source, content, date) VALUES (?, ?, ?)",
  );

  memDb.exec("BEGIN");
  try {
    // SOUL.md
    try {
      const soul = await readFile(config.paths.soul, "utf-8");
      if (soul.trim()) insert.run("soul", soul.trim(), null);
    } catch {
      /* file may not exist */
    }

    // HUMAN.md
    try {
      const human = await readFile(config.paths.human, "utf-8");
      for (const bullet of parseBulletLines(human)) {
        insert.run("human", bullet, null);
      }
    } catch {
      /* file may not exist */
    }

    // PREFERENCES.md
    try {
      const prefs = await readFile(config.paths.preferences, "utf-8");
      for (const bullet of parseBulletLines(prefs)) {
        insert.run("preferences", bullet, null);
      }
    } catch {
      /* file may not exist */
    }

    // Daily memory files
    try {
      const files = await readdir(config.paths.memoryDir);
      const memoryFiles = files.filter((f) => f.startsWith("MEMORY-") && f.endsWith(".md")).sort();
      for (const file of memoryFiles) {
        const dateMatch = file.match(/MEMORY-(\d{4}-\d{2}-\d{2})\.md/);
        const date = dateMatch?.[1] ?? null;
        const content = await readFile(join(config.paths.memoryDir, file), "utf-8");
        parseDailyMemoryContent(content, date, insert);
      }
    } catch {
      /* directory may not exist */
    }

    memDb.exec("COMMIT");
    log.info("Memory FTS backfill completed");
  } catch (err) {
    try {
      memDb.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function parseDailyMemoryContent(
  content: string,
  date: string | null,
  insert: ReturnType<DatabaseSync["prepare"]>,
): void {
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("## Session Context Summary")) {
      // Collect the entire block until next ## or end of file
      const blockLines = [line];
      i++;
      while (i < lines.length && !lines[i].startsWith("## ")) {
        blockLines.push(lines[i]);
        i++;
      }
      const block = blockLines.join("\n").trim();
      if (block) insert.run("daily", block, date);
    } else if (line.startsWith("- ")) {
      insert.run("daily", line.slice(2).trim(), date);
      i++;
    } else {
      i++;
    }
  }
}

export function closeMemoryDb(): void {
  if (db) {
    db.close();
    db = null;
    initialized = false;
  }
}
