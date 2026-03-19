import type { Context } from "grammy";
import { formatSystemStatusSummary, getSystemStatus } from "../runtime/state";
import { getChatModelContext } from "./model-context";

function buildStatusWithGroupedModels(summary: string, currentLine: string): string {
  const lines = summary.split("\n");
  const defaultIndex = lines.findIndex((line) => line.startsWith("Default model:"));

  if (defaultIndex === -1) {
    return `${summary}\n${currentLine}`;
  }

  lines.splice(defaultIndex + 1, 0, currentLine);
  return lines.join("\n");
}

export async function handleStatus(ctx: Context) {
  const status = await getSystemStatus();
  const summary = formatSystemStatusSummary(status);

  if (!ctx.chat) {
    await ctx.reply(summary);
    return;
  }

  const modelContext = getChatModelContext(String(ctx.chat.id));
  const currentLine = modelContext.overrideActive
    ? `Current chat model: \`${modelContext.currentModel}\` (override active)`
    : `Current chat model: \`${modelContext.currentModel}\` (using default)`;

  await ctx.reply(buildStatusWithGroupedModels(summary, currentLine), { parse_mode: "Markdown" });
}
