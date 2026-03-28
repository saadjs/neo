import type { Context } from "grammy";
import { getModelForChat } from "../agent";
import { config } from "../config";
import { USER_TIMEZONE } from "../constants";
import { getConfiguredProviders, parseQualifiedModel } from "../providers";
import {
  fetchCopilotUsage,
  fetchProviderUsage,
  type CopilotQuotaSnapshot,
  type CopilotUsageSnapshot,
  type ProviderUsageReport,
  type TokenUsageSnapshot,
  type VercelCreditsSnapshot,
} from "./usage-core";

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return `$${value}`;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed);
}

function normalizeQuotaCount(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

function buildQuotaLine(label: string, quota: CopilotQuotaSnapshot | null): string | null {
  if (!quota) return null;

  const remaining = normalizeQuotaCount(quota.remaining);
  const entitlement = normalizeQuotaCount(quota.entitlement);

  if (remaining != null && entitlement != null && entitlement > 0) {
    return `${label}: ${remaining} / ${entitlement} remaining (${formatPercent(quota.percentRemaining)})`;
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

function formatWindowRange(usage: TokenUsageSnapshot): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
  const windowEnd = new Date(usage.windowEnd);
  const displayEnd =
    windowEnd.getTime() > Date.parse(usage.windowStart)
      ? new Date(windowEnd.getTime() - 1)
      : windowEnd;

  return `${formatter.format(new Date(usage.windowStart))} to ${formatter.format(displayEnd)} UTC`;
}

function sectionTitle(label: string): string {
  if (label === "vercel") return "Vercel AI Gateway";
  if (label === "openai") return "OpenAI";
  if (label === "anthropic") return "Anthropic";
  return label;
}

function buildCopilotLines(usage: CopilotUsageSnapshot): string[] {
  const lines: string[] = [];

  if (usage.plan) {
    lines.push(`Plan: ${usage.plan}`);
  }

  const premiumLine = buildQuotaLine("Premium interactions", usage.premiumInteractions);
  const chatLine = buildQuotaLine("Chat", usage.chat);

  if (premiumLine) lines.push(premiumLine);
  if (chatLine) lines.push(chatLine);

  lines.push(`Resets in: ${usage.resetsIn}`);
  if (usage.resetAt) {
    lines.push(`Reset time: ${formatResetTime(usage.resetAt, USER_TIMEZONE)}`);
  }

  return lines;
}

function buildTokenLines(usage: TokenUsageSnapshot): string[] {
  const lines = [
    `Input tokens: ${formatInteger(usage.inputTokens)}`,
    `Output tokens: ${formatInteger(usage.outputTokens)}`,
  ];

  if (usage.requestCount != null) {
    lines.push(`Requests: ${formatInteger(usage.requestCount)}`);
  }

  lines.push(`Window: ${formatWindowRange(usage)}`);
  return lines;
}

function buildVercelLines(usage: VercelCreditsSnapshot): string[] {
  const lines: string[] = [];
  if (usage.balance != null) lines.push(`Balance: ${formatCurrency(usage.balance)}`);
  if (usage.totalUsed != null) lines.push(`Total used: ${formatCurrency(usage.totalUsed)}`);
  return lines;
}

function describeProviderError(report: ProviderUsageReport): string {
  if (!report.error) return "unknown error";

  if (report.providerKey === "anthropic" && report.error === "HTTP 401") {
    return "usage API rejected the configured Anthropic key";
  }

  if (report.providerKey === "anthropic" && report.error === "HTTP 403") {
    return "usage API requires higher Anthropic account access";
  }

  if (report.providerKey === "openai" && report.error === "HTTP 401") {
    return "usage API rejected the configured OpenAI key";
  }

  if (report.providerKey === "openai" && report.error === "HTTP 403") {
    return "organization usage endpoint is not accessible with the configured OpenAI key";
  }

  if (report.providerKey === "vercel" && report.error === "HTTP 401") {
    return "usage API rejected the configured Vercel token";
  }

  return report.error;
}

function buildReportSection(report: ProviderUsageReport): string[] {
  const lines = [sectionTitle(report.label)];

  if (!report.ok || !report.snapshot) {
    lines.push(`Unavailable: ${describeProviderError(report)}`);
    return lines;
  }

  if (report.snapshot.kind === "copilot") {
    lines.push(...buildCopilotLines(report.snapshot.usage));
    return lines;
  }

  if (report.snapshot.kind === "vercel") {
    lines.push(...buildVercelLines(report.snapshot.usage));
    return lines;
  }

  lines.push(...buildTokenLines(report.snapshot.usage));
  return lines;
}

export function buildUsageMessage(
  model: string,
  provider: string,
  reports: ProviderUsageReport[],
): string {
  const lines = ["📈 Usage", "", `Current model: ${model}`, `Current provider: ${provider}`];

  for (const report of reports) {
    lines.push("", ...buildReportSection(report));
  }

  return lines.join("\n");
}

export async function handleUsage(ctx: Context) {
  const model = getModelForChat(ctx.chat!.id);
  const { providerKey } = parseQualifiedModel(model);
  const configuredProviders = getConfiguredProviders()
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key));

  const [copilotResult, ...providerResults] = await Promise.all([
    fetchCopilotUsage(config.github.token),
    ...configuredProviders.map((provider) => fetchProviderUsage(provider)),
  ]);

  const reports: ProviderUsageReport[] = [
    copilotResult.ok
      ? {
          providerKey: "copilot",
          label: "GitHub Copilot",
          ok: true,
          snapshot: { kind: "copilot", usage: copilotResult.usage },
        }
      : {
          providerKey: "copilot",
          label: "GitHub Copilot",
          ok: false,
          error: copilotResult.error,
        },
    ...providerResults,
  ];

  await ctx.reply(buildUsageMessage(model, providerKey ?? "copilot", reports));
}
