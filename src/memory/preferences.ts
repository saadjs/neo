import { readFile, writeFile, appendFile } from "node:fs/promises";
import { config } from "../config.js";

export async function loadPreferences(): Promise<string> {
  try {
    return await readFile(config.paths.preferences, "utf-8");
  } catch {
    return "# Preferences\n";
  }
}

export async function savePreferences(content: string): Promise<void> {
  await writeFile(config.paths.preferences, content, "utf-8");
}

export async function appendPreference(preference: string): Promise<void> {
  const current = await loadPreferences();
  if (current.includes(preference)) return; // no duplicates
  await appendFile(config.paths.preferences, `- ${preference}\n`, "utf-8");
}
