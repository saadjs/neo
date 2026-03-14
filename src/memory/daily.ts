import { readFile, writeFile, appendFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { config } from "../config.js";
import { insertMemoryEntry, searchMemoryFts } from "./db.js";

function todayDateString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function todayFileName(): string {
  return `MEMORY-${todayDateString()}.md`;
}

function memoryFilePath(filename?: string): string {
  return join(config.paths.memoryDir, filename ?? todayFileName());
}

export async function ensureMemoryDir() {
  await mkdir(config.paths.memoryDir, { recursive: true });
}

async function ensureTodayMemoryFile(): Promise<string> {
  await ensureMemoryDir();
  const path = memoryFilePath();
  if (!existsSync(path)) {
    const header = `# Memory — ${new Date().toISOString().split("T")[0]}\n\n`;
    await writeFile(path, header, "utf-8");
  }
  return path;
}

async function appendRawDailyMemory(content: string): Promise<void> {
  const path = await ensureTodayMemoryFile();
  await appendFile(path, content, "utf-8");
}

export async function readDailyMemory(date?: string): Promise<string> {
  const filename = date ? `MEMORY-${date}.md` : todayFileName();
  try {
    return await readFile(memoryFilePath(filename), "utf-8");
  } catch {
    return "";
  }
}

export async function appendDailyMemory(content: string): Promise<void> {
  await appendRawDailyMemory(`- ${content}\n`);
  insertMemoryEntry("daily", content, todayDateString());
}

export interface CompactionMemoryEntry {
  timestamp: string;
  chatId: number;
  sessionId: string;
  model?: string;
  preCompactionTokens?: number;
  postCompactionTokens?: number;
  messagesRemoved?: number;
  checkpointNumber?: number;
  checkpointPath?: string;
  summaryContent: string;
}

export async function appendCompactionMemory(entry: CompactionMemoryEntry): Promise<void> {
  const lines = [
    "## Session Context Summary",
    `- Timestamp: ${entry.timestamp}`,
    `- Chat ID: ${entry.chatId}`,
    `- Session ID: ${entry.sessionId}`,
    entry.model ? `- Model: ${entry.model}` : undefined,
    entry.preCompactionTokens !== undefined
      ? `- Tokens Before: ${entry.preCompactionTokens}`
      : undefined,
    entry.postCompactionTokens !== undefined
      ? `- Tokens After: ${entry.postCompactionTokens}`
      : undefined,
    entry.messagesRemoved !== undefined
      ? `- Messages Removed: ${entry.messagesRemoved}`
      : undefined,
    entry.checkpointNumber !== undefined ? `- Checkpoint: ${entry.checkpointNumber}` : undefined,
    entry.checkpointPath ? `- Checkpoint Path: ${entry.checkpointPath}` : undefined,
    "",
    "### Summary",
    entry.summaryContent.trim(),
    "",
  ].filter(Boolean);

  const formatted = lines.join("\n");
  await appendRawDailyMemory(`${formatted}\n`);
  insertMemoryEntry("daily", formatted, todayDateString());
}

export async function listMemoryFiles(): Promise<string[]> {
  await ensureMemoryDir();
  try {
    const files = await readdir(config.paths.memoryDir);
    return files.filter((f) => f.startsWith("MEMORY-") && f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

export async function searchMemory(query: string): Promise<string> {
  const results = searchMemoryFts(query);
  if (results.length === 0) return "No matches found.";
  return results
    .map((r) => {
      const label = r.date ? `${r.source} (${r.date})` : r.source;
      return `**${label}**: ${r.snippet}`;
    })
    .join("\n\n");
}
