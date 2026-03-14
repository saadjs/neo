import type { Context } from "grammy";
import { getModelForChat } from "../agent.js";
import { config } from "../config.js";
import {
  fetchCopilotUsage,
  type CopilotQuotaSnapshot,
  type CopilotUsageSnapshot,
} from "./usage-core.js";

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function buildQuotaLine(label: string, quota: CopilotQuotaSnapshot | null): string | null {
  if (!quota) return null;

  if (quota.remaining != null && quota.entitlement != null) {
    return `${label}: ${quota.remaining} / ${quota.entitlement} remaining (${formatPercent(quota.percentRemaining)})`;
  }

  return `${label}: ${formatPercent(quota.percentRemaining)} remaining`;
}

export function buildUsageMessage(model: string, usage: CopilotUsageSnapshot): string {
  const lines = ["📈 Copilot Usage", "", `Model: ${model}`];

  if (usage.plan) {
    lines.push(`Plan: ${usage.plan}`);
  }

  const premiumLine = buildQuotaLine("Premium interactions", usage.premiumInteractions);
  const chatLine = buildQuotaLine("Chat", usage.chat);

  if (premiumLine || chatLine) {
    lines.push("");
  }

  if (premiumLine) {
    lines.push(premiumLine);
  }

  if (chatLine) {
    lines.push(chatLine);
  }

  lines.push(`Resets in: ${usage.resetsIn}`);

  return lines.join("\n");
}

export async function handleUsage(ctx: Context) {
  const model = getModelForChat(ctx.chat!.id);
  const result = await fetchCopilotUsage(config.github.token);

  if (!result.ok) {
    await ctx.reply(`Copilot usage is unavailable right now (${result.error}).`);
    return;
  }

  await ctx.reply(buildUsageMessage(model, result.usage));
}
