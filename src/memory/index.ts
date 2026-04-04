export { loadSoul, saveSoul } from "./soul";
export { loadPreferences, savePreferences, appendPreference } from "./preferences";
export { loadHuman, saveHuman, appendHuman } from "./human";
export {
  readDailyMemory,
  appendDailyMemory,
  appendCompactionMemory,
  listMemoryFiles,
  searchMemory,
  ensureMemoryDir,
  isChannelChat,
} from "./daily";
export {
  initMemoryTable,
  searchMemoryFts,
  getChannelConfig,
  upsertChannelConfig,
  listChannelConfigs,
} from "./db";
export type { ChannelConfig } from "./db";
export { runMemoryDecay } from "./decay";

import { loadSoul } from "./soul";
import { loadPreferences } from "./preferences";
import { loadHuman } from "./human";
import { isChannelChat } from "./daily";
import { loadRecentSummaries } from "./decay";
import { getChannelConfig } from "./db";
import { USER_TIMEZONE } from "../constants";

export interface SystemContextParts {
  /** Neo's identity (soul + optional channel overlay). Replaces SDK identity section. */
  identity: string;
  /** Dynamic context appended after all SDK sections. */
  additionalContent: string;
}

/**
 * Build the system context split into identity and additional content.
 *
 * Identity replaces the SDK's `identity` and `tone` sections (Neo's soul
 * encapsulates both). Everything else — human profile, preferences, channel
 * config, summaries, timezone — goes into `additionalContent` so the SDK
 * keeps control of its own safety, tool-efficiency, guidelines, etc.
 */
export async function buildSystemContextParts(chatId?: number): Promise<SystemContextParts> {
  const isChannel = chatId != null && isChannelChat(chatId);
  const channelConfig = isChannel ? getChannelConfig(chatId) : null;

  const [soul, preferences, human, weeklySummaries] = await Promise.all([
    loadSoul(),
    loadPreferences(),
    loadHuman(),
    loadRecentSummaries(),
  ]);

  // --- Identity (replaces SDK identity + tone sections) ---
  const identityParts = [soul];
  if (channelConfig?.soulOverlay?.trim()) {
    identityParts.push(`\n---\n\n## Channel Persona\n\n${channelConfig.soulOverlay}`);
  }
  const identity = identityParts.join("\n");

  // --- Additional content (appended after SDK-managed sections) ---
  const contentParts: string[] = [];

  if (human.trim().split("\n").length > 1) {
    contentParts.push(`## About the Human\n\n${human}`);
  }

  if (preferences.trim().split("\n").length > 1) {
    contentParts.push(`## User Preferences\n\n${preferences}`);
  }

  if (channelConfig?.preferences?.trim()) {
    contentParts.push(`## Channel Preferences\n\n${channelConfig.preferences}`);
  }

  if (channelConfig?.topics?.trim()) {
    contentParts.push(
      `## Topic Enforcement\n\nThis channel is restricted to: ${channelConfig.topics}.\nIf the user's message is unrelated to these topics, politely let them know this channel is for ${channelConfig.topics} and suggest asking in the right channel.\nDo NOT answer off-topic questions.`,
    );
  }

  if (weeklySummaries.trim()) {
    contentParts.push(`## Recent Weekly Summaries\n\n${weeklySummaries}`);
  }

  const channelWeeklySummaries = isChannel ? await loadRecentSummaries(4, chatId) : "";
  if (channelWeeklySummaries.trim()) {
    contentParts.push(`## Channel Weekly Summaries\n\n${channelWeeklySummaries}`);
  }

  if (isChannel) {
    const label = channelConfig?.label || "unlabeled";
    contentParts.push(
      `## Current Channel\n\nChat ID: ${chatId}\nLabel: ${label}\nWhen using the memory tool, pass \`channel: ${chatId}\` to scope reads/writes to this channel.`,
    );
  }

  contentParts.push(
    `## Timezone\n\nThe user's timezone is ${USER_TIMEZONE}. Always convert times to this timezone when displaying to the user, and convert from this timezone to UTC when storing times (e.g. for reminders).`,
  );

  return { identity, additionalContent: contentParts.join("\n\n---\n\n") };
}

/**
 * Build the full system context as a single string.
 * Retained for backward compatibility with tests and any code that needs
 * the flattened prompt.
 */
export async function buildSystemContext(chatId?: number): Promise<string> {
  const { identity, additionalContent } = await buildSystemContextParts(chatId);
  return `${identity}\n\n---\n\n${additionalContent}`;
}
