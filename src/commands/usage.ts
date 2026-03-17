import type { Context } from "grammy";
import { getModelForChat } from "../agent";
import { config } from "../config";
import { USER_TIMEZONE } from "../constants";
import {
  fetchCopilotUsage,
  type CopilotQuotaSnapshot,
  type CopilotUsageSnapshot,
} from "./usage-core";

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

function formatResetTime(isoDate: string, timeZone: string): string {
  const date = new Date(isoDate);

  const localFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const utcFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return `${localFormatter.format(date)} ET (${utcFormatter.format(date)} UTC)`;
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
  if (usage.resetAt) {
    lines.push(`Reset time: ${formatResetTime(usage.resetAt, USER_TIMEZONE)}`);
  }

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
