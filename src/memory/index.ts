export { loadSoul, saveSoul } from "./soul.js";
export { loadPreferences, savePreferences, appendPreference } from "./preferences.js";
export { loadHuman, saveHuman, appendHuman } from "./human.js";
export {
  readDailyMemory,
  appendDailyMemory,
  appendCompactionMemory,
  listMemoryFiles,
  searchMemory,
  ensureMemoryDir,
} from "./daily.js";

import { loadSoul } from "./soul.js";
import { loadPreferences } from "./preferences.js";
import { loadHuman } from "./human.js";
import { readDailyMemory } from "./daily.js";

export async function buildSystemContext(): Promise<string> {
  const [soul, preferences, human, todayMemory] = await Promise.all([
    loadSoul(),
    loadPreferences(),
    loadHuman(),
    readDailyMemory(),
  ]);

  const parts = [soul];

  if (human.trim().split("\n").length > 1) {
    parts.push(`\n---\n\n## About the Human\n\n${human}`);
  }

  if (preferences.trim().split("\n").length > 1) {
    parts.push(`\n---\n\n## User Preferences\n\n${preferences}`);
  }

  if (todayMemory.trim()) {
    parts.push(`\n---\n\n## Today's Memory\n\n${todayMemory}`);
  }

  parts.push(
    `\n---\n\n## Timezone\n\nThe user's timezone is America/New_York. Always convert times to this timezone when displaying to the user, and convert from this timezone to UTC when storing times (e.g. for reminders).`,
  );

  return parts.join("\n");
}
