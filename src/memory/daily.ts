import { readFile, writeFile, appendFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { config } from "../config.js";

function todayFileName(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `MEMORY-${yyyy}-${mm}-${dd}.md`;
}

function memoryFilePath(filename?: string): string {
  return join(config.paths.memoryDir, filename ?? todayFileName());
}

export async function ensureMemoryDir() {
  await mkdir(config.paths.memoryDir, { recursive: true });
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
  await ensureMemoryDir();
  const path = memoryFilePath();
  if (!existsSync(path)) {
    const header = `# Memory — ${new Date().toISOString().split("T")[0]}\n\n`;
    await writeFile(path, header, "utf-8");
  }
  await appendFile(path, `- ${content}\n`, "utf-8");
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
  const files = await listMemoryFiles();
  const results: string[] = [];
  const lowerQuery = query.toLowerCase();

  for (const file of files.slice(-30)) {
    const content = await readFile(memoryFilePath(file), "utf-8");
    const lines = content.split("\n").filter((l) => l.toLowerCase().includes(lowerQuery));
    if (lines.length > 0) {
      results.push(`**${file}**:\n${lines.join("\n")}`);
    }
  }
  return results.length > 0 ? results.join("\n\n") : "No matches found.";
}
