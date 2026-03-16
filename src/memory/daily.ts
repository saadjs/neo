import { readFile, writeFile, appendFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { config } from "../config";
import { insertMemoryEntry, searchMemoryFts } from "./db";

function todayDateString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dailyFileName(date?: string, chatId?: number): string {
  const d = date ?? todayDateString();
  return chatId ? `MEMORY-${chatId}-${d}.md` : `MEMORY-${d}.md`;
}

function memoryFilePath(filename?: string): string {
  return join(config.paths.memoryDir, filename ?? dailyFileName());
}

export function isChannelChat(chatId: number): boolean {
  return chatId < 0;
}

export async function ensureMemoryDir() {
  await mkdir(config.paths.memoryDir, { recursive: true });
}

async function ensureDailyMemoryFile(chatId?: number): Promise<string> {
  await ensureMemoryDir();
  const path = memoryFilePath(dailyFileName(undefined, chatId));
  if (!existsSync(path)) {
    const label = chatId ? ` (Channel ${chatId})` : "";
    const header = `# Memory${label} — ${new Date().toISOString().split("T")[0]}\n\n`;
    await writeFile(path, header, "utf-8");
  }
  return path;
}

async function appendRawDailyMemory(content: string, chatId?: number): Promise<void> {
  const path = await ensureDailyMemoryFile(chatId);
  await appendFile(path, content, "utf-8");
}

export async function readDailyMemory(date?: string, chatId?: number): Promise<string> {
  const filename = dailyFileName(date, chatId);
  try {
    return await readFile(memoryFilePath(filename), "utf-8");
  } catch {
    return "";
  }
}

export async function appendDailyMemory(content: string, chatId?: number): Promise<void> {
  await appendRawDailyMemory(`- ${content}\n`, chatId);
  insertMemoryEntry("daily", content, todayDateString(), chatId);
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
  const channelChatId = isChannelChat(entry.chatId) ? entry.chatId : undefined;
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
  await appendRawDailyMemory(`${formatted}\n`, channelChatId);
  insertMemoryEntry("daily", formatted, todayDateString(), channelChatId);
}

export async function listMemoryFiles(chatId?: number): Promise<string[]> {
  await ensureMemoryDir();
  try {
    const files = await readdir(config.paths.memoryDir);
    if (chatId != null) {
      const escapedChatId = String(chatId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const channelPattern = new RegExp(
        `^(MEMORY-${escapedChatId}-\\d{4}-\\d{2}-\\d{2}|MEMORY-SUMMARY-ch${escapedChatId}-\\d{4}-W\\d{2})\\.md$`,
      );
      return files.filter((f) => channelPattern.test(f)).sort();
    }
    return files
      .filter((f) => /^(MEMORY-\d{4}-\d{2}-\d{2}|MEMORY-SUMMARY-\d{4}-W\d{2})\.md$/.test(f))
      .sort();
  } catch {
    return [];
  }
}

export async function searchMemory(query: string, chatId?: number): Promise<string> {
  const results = searchMemoryFts(query, 20, chatId);
  if (results.length === 0) return "No matches found.";
  return results
    .map((r) => {
      const label = r.date ? `${r.source} (${r.date})` : r.source;
      return `**${label}**: ${r.snippet}`;
    })
    .join("\n\n");
}
