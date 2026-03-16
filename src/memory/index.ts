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
  isChannelChat,
} from "./daily.js";
export {
  initMemoryTable,
  searchMemoryFts,
  getChannelConfig,
  upsertChannelConfig,
  listChannelConfigs,
} from "./db.js";
export type { ChannelConfig } from "./db.js";
export { runMemoryDecay } from "./decay.js";

import { loadSoul } from "./soul.js";
import { loadPreferences } from "./preferences.js";
import { loadHuman } from "./human.js";
import { isChannelChat } from "./daily.js";
import { loadRecentSummaries } from "./decay.js";
import { getChannelConfig } from "./db.js";

export async function buildSystemContext(chatId?: number): Promise<string> {
  const isChannel = chatId != null && isChannelChat(chatId);
  const channelConfig = isChannel ? getChannelConfig(chatId) : null;

  const [soul, preferences, human, weeklySummaries] = await Promise.all([
    loadSoul(),
    loadPreferences(),
    loadHuman(),
    loadRecentSummaries(),
  ]);

  // Channel-scoped weekly summaries (daily memory is injected via onSessionStart hook)
  const channelWeeklySummaries = isChannel ? await loadRecentSummaries(4, chatId) : "";

  const parts = [soul];

  // Channel soul overlay
  if (channelConfig?.soulOverlay?.trim()) {
    parts.push(`\n---\n\n## Channel Persona\n\n${channelConfig.soulOverlay}`);
  }

  if (human.trim().split("\n").length > 1) {
    parts.push(`\n---\n\n## About the Human\n\n${human}`);
  }

  if (preferences.trim().split("\n").length > 1) {
    parts.push(`\n---\n\n## User Preferences\n\n${preferences}`);
  }

  // Channel preferences
  if (channelConfig?.preferences?.trim()) {
    parts.push(`\n---\n\n## Channel Preferences\n\n${channelConfig.preferences}`);
  }

  // Topic enforcement
  if (channelConfig?.topics?.trim()) {
    parts.push(
      `\n---\n\n## Topic Enforcement\n\nThis channel is restricted to: ${channelConfig.topics}.\nIf the user's message is unrelated to these topics, politely let them know this channel is for ${channelConfig.topics} and suggest asking in the right channel.\nDo NOT answer off-topic questions.`,
    );
  }

  if (weeklySummaries.trim()) {
    parts.push(`\n---\n\n## Recent Weekly Summaries\n\n${weeklySummaries}`);
  }

  // Channel weekly summaries
  if (channelWeeklySummaries.trim()) {
    parts.push(`\n---\n\n## Channel Weekly Summaries\n\n${channelWeeklySummaries}`);
  }

  // Current channel info
  if (isChannel) {
    const label = channelConfig?.label || "unlabeled";
    parts.push(
      `\n---\n\n## Current Channel\n\nChat ID: ${chatId}\nLabel: ${label}\nWhen using the memory tool, pass \`channel: ${chatId}\` to scope reads/writes to this channel.`,
    );
  }

  parts.push(
    `\n---\n\n## Timezone\n\nThe user's timezone is America/New_York. Always convert times to this timezone when displaying to the user, and convert from this timezone to UTC when storing times (e.g. for reminders).`,
  );

  return parts.join("\n");
}
