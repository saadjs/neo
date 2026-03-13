export { loadSoul, saveSoul } from "./soul.js";
export { loadPreferences, savePreferences, appendPreference } from "./preferences.js";
export {
  readDailyMemory,
  appendDailyMemory,
  listMemoryFiles,
  searchMemory,
  ensureMemoryDir,
} from "./daily.js";

import { loadSoul } from "./soul.js";
import { loadPreferences } from "./preferences.js";
import { readDailyMemory } from "./daily.js";

export async function buildSystemContext(): Promise<string> {
  const [soul, preferences, todayMemory] = await Promise.all([
    loadSoul(),
    loadPreferences(),
    readDailyMemory(),
  ]);

  const parts = [soul];

  if (preferences.trim().split("\n").length > 1) {
    parts.push(`\n---\n\n## User Preferences\n\n${preferences}`);
  }

  if (todayMemory.trim()) {
    parts.push(`\n---\n\n## Today's Memory\n\n${todayMemory}`);
  }

  return parts.join("\n");
}
