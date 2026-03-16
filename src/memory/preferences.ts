import { readFile, writeFile, appendFile } from "node:fs/promises";
import { config } from "../config";
import { insertMemoryEntry, replaceMemorySource } from "./db";

export async function loadPreferences(): Promise<string> {
  try {
    return await readFile(config.paths.preferences, "utf-8");
  } catch {
    return "# Preferences\n";
  }
}

export async function savePreferences(content: string): Promise<void> {
  await writeFile(config.paths.preferences, content, "utf-8");
  const bullets = content
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => ({ content: l.slice(2).trim() }))
    .filter((e) => e.content);
  replaceMemorySource("preferences", bullets);
}

export async function appendPreference(preference: string): Promise<void> {
  const current = await loadPreferences();
  if (current.includes(preference)) return; // no duplicates
  await appendFile(config.paths.preferences, `- ${preference}\n`, "utf-8");
  insertMemoryEntry("preferences", preference);
}
