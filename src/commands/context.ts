import type { Context } from "grammy";
import {
  loadSoul,
  loadPreferences,
  loadHuman,
  readDailyMemory,
  isChannelChat,
  getChannelConfig,
} from "../memory/index";
import { loadRecentSummaries } from "../memory/decay";
import { getRuntimeContextSection } from "../runtime/state";
import { formatAnomaliesForContext } from "../logging/anomalies";
import { USER_TIMEZONE } from "../constants";

type Section = { name: string; content: string; display?: string };

function lineCount(text: string): number {
  return text.trim().split("\n").length;
}

export async function handleContext(ctx: Context) {
  const chatId = String(ctx.chat!.id);
  const isChannel = isChannelChat(chatId);
  const channelConfig = isChannel ? getChannelConfig(chatId) : null;

  const [
    soul,
    preferences,
    human,
    weeklySummaries,
    channelWeeklySummaries,
    todayMemory,
    channelTodayMemory,
  ] = await Promise.all([
    loadSoul(),
    loadPreferences(),
    loadHuman(),
    loadRecentSummaries(),
    isChannel ? loadRecentSummaries(4, chatId) : Promise.resolve(""),
    readDailyMemory(),
    isChannel ? readDailyMemory(undefined, chatId) : Promise.resolve(""),
  ]);

  const sections: Section[] = [
    { name: "Soul", content: soul },
    { name: "Channel Persona", content: channelConfig?.soulOverlay ?? "" },
    { name: "About the Human", content: human.trim().split("\n").length > 1 ? human : "" },
    {
      name: "User Preferences",
      content: preferences.trim().split("\n").length > 1 ? preferences : "",
    },
    { name: "Channel Preferences", content: channelConfig?.preferences ?? "" },
    { name: "Topic Enforcement", content: channelConfig?.topics ?? "" },
    { name: "Weekly Summaries", content: weeklySummaries },
    { name: "Channel Weekly Summaries", content: channelWeeklySummaries },
    { name: "Timezone", content: USER_TIMEZONE, display: USER_TIMEZONE },
    { name: "Today's Memory", content: todayMemory },
    { name: "Channel Memory (Today)", content: channelTodayMemory },
    { name: "Runtime Context", content: getRuntimeContextSection() ?? "" },
    { name: "Anomalies", content: formatAnomaliesForContext() },
  ];

  const maxNameLen = Math.max(...sections.map((s) => s.name.length));
  const values = sections.map((s) =>
    s.display ? s.display : s.content.trim() ? String(lineCount(s.content)) : "—",
  );
  const totalChars = sections.reduce((sum, s) => sum + s.content.length, 0);
  const totalValue = `~${totalChars.toLocaleString()} chars`;
  const maxValueLen = Math.max(...values.map((v) => v.length), "Lines".length, totalValue.length);

  const lines = sections.map((s, i) => {
    return `${s.name.padEnd(maxNameLen)}  ${values[i].padStart(maxValueLen)}`;
  });

  const separator = "─".repeat(maxNameLen + 2 + maxValueLen);

  const output = `Session Context

<pre>
${"Section".padEnd(maxNameLen)}  ${"Lines".padStart(maxValueLen)}
${separator}
${lines.join("\n")}
${separator}
${"Total".padEnd(maxNameLen)}  ${totalValue.padStart(maxValueLen)}
</pre>`;

  await ctx.reply(output, { parse_mode: "HTML" }).catch(() => ctx.reply(output));
}
