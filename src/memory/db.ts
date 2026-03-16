import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config";
import { getLogger } from "../logging/index";

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

  // Idempotent migration: add chat_id column to memory_entries
  try {
    memDb.exec("ALTER TABLE memory_entries ADD COLUMN chat_id INTEGER");
  } catch {
    // Column already exists
  }
  memDb.exec("CREATE INDEX IF NOT EXISTS idx_memory_chat_id ON memory_entries(chat_id)");

  const row = memDb.prepare("SELECT COUNT(*) AS cnt FROM memory_entries").get() as { cnt: number };
  if (row.cnt === 0) {
    backfillFromFiles(memDb).catch((err) => {
      getLogger().error({ err }, "Memory FTS backfill failed");
    });
  }

  initialized = true;
}

export function insertMemoryEntry(
  source: string,
  content: string,
  date?: string,
  chatId?: number,
): void {
  initMemoryTable();
  try {
    getMemoryDb()
      .prepare("INSERT INTO memory_entries (source, content, date, chat_id) VALUES (?, ?, ?, ?)")
      .run(source, content, date ?? null, chatId ?? null);
  } catch (err) {
    getLogger().error({ err }, "Failed to insert memory entry");
  }
}

export function replaceMemorySource(
  source: string,
  entries: { content: string; date?: string }[],
  chatId?: number,
): void {
  initMemoryTable();
  const memDb = getMemoryDb();
  try {
    memDb.exec("BEGIN IMMEDIATE");
    if (chatId != null) {
      memDb
        .prepare("DELETE FROM memory_entries WHERE source = ? AND chat_id = ?")
        .run(source, chatId);
    } else {
      memDb.prepare("DELETE FROM memory_entries WHERE source = ? AND chat_id IS NULL").run(source);
    }
    const insert = memDb.prepare(
      "INSERT INTO memory_entries (source, content, date, chat_id) VALUES (?, ?, ?, ?)",
    );
    for (const entry of entries) {
      insert.run(source, entry.content, entry.date ?? null, chatId ?? null);
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

export function searchMemoryFts(query: string, limit = 20, chatId?: number): MemorySearchResult[] {
  initMemoryTable();
  const sanitized = `"${query.replace(/"/g, '""')}"`;
  try {
    if (chatId != null) {
      return getMemoryDb()
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
        .all(sanitized, chatId, limit) as unknown as MemorySearchResult[];
    }
    return getMemoryDb()
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
    "INSERT INTO memory_entries (source, content, date, chat_id) VALUES (?, ?, ?, ?)",
  );

  memDb.exec("BEGIN");
  try {
    // SOUL.md
    try {
      const soul = await readFile(config.paths.soul, "utf-8");
      if (soul.trim()) insert.run("soul", soul.trim(), null, null);
    } catch {
      /* file may not exist */
    }

    // HUMAN.md
    try {
      const human = await readFile(config.paths.human, "utf-8");
      for (const bullet of parseBulletLines(human)) {
        insert.run("human", bullet, null, null);
      }
    } catch {
      /* file may not exist */
    }

    // PREFERENCES.md
    try {
      const prefs = await readFile(config.paths.preferences, "utf-8");
      for (const bullet of parseBulletLines(prefs)) {
        insert.run("preferences", bullet, null, null);
      }
    } catch {
      /* file may not exist */
    }

    // Daily memory files (global)
    try {
      const files = await readdir(config.paths.memoryDir);
      const memoryFiles = files.filter((f) => f.startsWith("MEMORY-") && f.endsWith(".md")).sort();
      for (const file of memoryFiles) {
        // Global: MEMORY-YYYY-MM-DD.md
        const globalMatch = file.match(/^MEMORY-(\d{4}-\d{2}-\d{2})\.md$/);
        if (globalMatch) {
          const date = globalMatch[1];
          const content = await readFile(join(config.paths.memoryDir, file), "utf-8");
          parseDailyMemoryContent(content, date, insert);
          continue;
        }
        // Channel-scoped: MEMORY-{chatId}-YYYY-MM-DD.md
        const channelMatch = file.match(/^MEMORY-(-?\d+)-(\d{4}-\d{2}-\d{2})\.md$/);
        if (channelMatch) {
          const chatId = Number(channelMatch[1]);
          const date = channelMatch[2];
          const content = await readFile(join(config.paths.memoryDir, file), "utf-8");
          parseDailyMemoryContent(content, date, insert, chatId);
        }
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
  chatId?: number,
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
      if (block) insert.run("daily", block, date, chatId ?? null);
    } else if (line.startsWith("- ")) {
      insert.run("daily", line.slice(2).trim(), date, chatId ?? null);
      i++;
    } else {
      i++;
    }
  }
}

export interface ChannelConfig {
  chatId: number;
  label: string | null;
  soulOverlay: string | null;
  preferences: string | null;
  topics: string | null;
}

export function getChannelConfig(chatId: number): ChannelConfig | null {
  initMemoryTable();
  const row = getMemoryDb()
    .prepare(
      "SELECT chat_id, label, soul_overlay, preferences, topics FROM channel_config WHERE chat_id = ?",
    )
    .get(chatId) as
    | {
        chat_id: number;
        label: string | null;
        soul_overlay: string | null;
        preferences: string | null;
        topics: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    chatId: row.chat_id,
    label: row.label,
    soulOverlay: row.soul_overlay,
    preferences: row.preferences,
    topics: row.topics,
  };
}

export function upsertChannelConfig(
  chatId: number,
  updates: Partial<Omit<ChannelConfig, "chatId">>,
): void {
  initMemoryTable();
  const existing = getChannelConfig(chatId);
  const memDb = getMemoryDb();

  if (existing) {
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: (string | number | null)[] = [];
    if ("label" in updates) {
      fields.push("label = ?");
      values.push(updates.label ?? null);
    }
    if ("soulOverlay" in updates) {
      fields.push("soul_overlay = ?");
      values.push(updates.soulOverlay ?? null);
    }
    if ("preferences" in updates) {
      fields.push("preferences = ?");
      values.push(updates.preferences ?? null);
    }
    if ("topics" in updates) {
      fields.push("topics = ?");
      values.push(updates.topics ?? null);
    }
    values.push(chatId);
    memDb
      .prepare(`UPDATE channel_config SET ${fields.join(", ")} WHERE chat_id = ?`)
      .run(...values);
  } else {
    memDb
      .prepare(
        "INSERT INTO channel_config (chat_id, label, soul_overlay, preferences, topics) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        chatId,
        updates.label ?? null,
        updates.soulOverlay ?? null,
        updates.preferences ?? null,
        updates.topics ?? null,
      );
  }
}

export function listChannelConfigs(): ChannelConfig[] {
  initMemoryTable();
  const rows = getMemoryDb()
    .prepare(
      "SELECT chat_id, label, soul_overlay, preferences, topics FROM channel_config ORDER BY chat_id",
    )
    .all() as {
    chat_id: number;
    label: string | null;
    soul_overlay: string | null;
    preferences: string | null;
    topics: string | null;
  }[];
  return rows.map((row) => ({
    chatId: row.chat_id,
    label: row.label,
    soulOverlay: row.soul_overlay,
    preferences: row.preferences,
    topics: row.topics,
  }));
}

export function closeMemoryDb(): void {
  if (db) {
    db.close();
    db = null;
    initialized = false;
  }
}
