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
import { readDailyMemory, isChannelChat } from "./daily.js";
import { loadRecentSummaries } from "./decay.js";
import { getChannelConfig } from "./db.js";
import { getRuntimeContextSection } from "../runtime/state.js";
import { formatAnomaliesForContext } from "../logging/anomalies.js";

export async function buildSystemContext(chatId?: number): Promise<string> {
  const isChannel = chatId != null && isChannelChat(chatId);
  const channelConfig = isChannel ? getChannelConfig(chatId) : null;

  const [soul, preferences, human, todayMemory, weeklySummaries] = await Promise.all([
    loadSoul(),
    loadPreferences(),
    loadHuman(),
    readDailyMemory(),
    loadRecentSummaries(),
  ]);

  // Also load channel-scoped memory when applicable
  const [channelTodayMemory, channelWeeklySummaries] = isChannel
    ? await Promise.all([readDailyMemory(undefined, chatId), loadRecentSummaries(4, chatId)])
    : ["", ""];

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

  if (todayMemory.trim()) {
    parts.push(`\n---\n\n## Today's Memory\n\n${todayMemory}`);
  }

  // Channel today's memory
  if (channelTodayMemory.trim()) {
    parts.push(`\n---\n\n## Channel Memory (Today)\n\n${channelTodayMemory}`);
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

  const runtimeContext = getRuntimeContextSection();
  if (runtimeContext) {
    parts.push(`\n---\n\n${runtimeContext}`);
  }

  parts.push(
    `\n---\n\n## Timezone\n\nThe user's timezone is America/New_York. Always convert times to this timezone when displaying to the user, and convert from this timezone to UTC when storing times (e.g. for reminders).`,
  );

  const anomalies = formatAnomaliesForContext();
  if (anomalies) {
    parts.push(`\n---\n\n${anomalies}`);
  }

  return parts.join("\n");
}
