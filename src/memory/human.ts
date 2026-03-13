import { readFile, writeFile, appendFile } from "node:fs/promises";
import { config } from "../config.js";

export async function loadHuman(): Promise<string> {
  try {
    return await readFile(config.paths.human, "utf-8");
  } catch {
    return "# Human\n";
  }
}

export async function saveHuman(content: string): Promise<void> {
  await writeFile(config.paths.human, content, "utf-8");
}

export async function appendHuman(entry: string): Promise<void> {
  const current = await loadHuman();
  if (current.includes(entry)) return;
  await appendFile(config.paths.human, `- ${entry}\n`, "utf-8");
}
