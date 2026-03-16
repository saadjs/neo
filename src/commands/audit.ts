import type { Context } from "grammy";
import { getToolUsageSummary, getToolHistory, getSessionStats } from "../logging/audit-queries";
import { formatSqliteUtcTimestamp, startOfUtcDay } from "./reporting-time";
import { truncateTelegramMessage } from "../telegram/messages";

function formatDuration(ms: number | null): string {
  if (ms == null) return "n/a";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(str: string, max: number): string {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function buildSummaryMessage(label: string, since: string): string {
  const summary = getToolUsageSummary(since);
  const stats = getSessionStats(since);

  if (summary.length === 0) {
    return `📊 Tool Usage — ${label}\n\nNo tool calls recorded.`;
  }

  const nameWidth = Math.max(4, ...summary.map((r) => r.tool_name.length));
  const header = `${"Tool".padEnd(nameWidth)}  Calls  OK%    Avg`;
  const rows = summary.map((r) => {
    const name = r.tool_name.padEnd(nameWidth);
    const calls = String(r.total_calls).padStart(5);
    const rate = `${Math.round(r.success_rate)}%`.padStart(4);
    const avg = formatDuration(r.avg_duration_ms).padStart(6);
    return `${name} ${calls} ${rate} ${avg}`;
  });

  const table = [header, ...rows].join("\n");
  const footer = `Total: ${stats.total_tool_calls} calls across ${summary.length} tools`;

  return truncateTelegramMessage(`📊 Tool Usage — ${label}\n\n\`\`\`\n${table}\n\`\`\`\n${footer}`);
}

function buildToolHistoryMessage(toolName: string): string {
  const invocations = getToolHistory(toolName, 10);

  if (invocations.length === 0) {
    return `🔍 No recent calls for \`${toolName}\``;
  }

  const lines = invocations.map((inv) => {
    const ts = inv.created_at.replace("T", " ").slice(0, 16);
    const icon = inv.success ? "✅" : "❌";
    const dur = formatDuration(inv.duration_ms);
    const args = truncate(inv.arguments ?? "", 60);
    return `${ts}  ${icon}  ${dur.padStart(6)}  ${args}`;
  });

  return truncateTelegramMessage(
    `🔍 Recent: ${toolName} (last ${invocations.length})\n\n\`\`\`\n${lines.join("\n")}\n\`\`\``,
  );
}

export function getAuditSummaryWindow(
  arg: string,
  now = new Date(),
): { label: string; since: string } | null {
  if (!arg) {
    return {
      label: "Today",
      since: formatSqliteUtcTimestamp(startOfUtcDay(now)),
    };
  }

  if (arg === "week") {
    return {
      label: "Past 7 Days",
      since: formatSqliteUtcTimestamp(new Date(now.getTime() - 7 * 86_400_000)),
    };
  }

  return null;
}

export async function handleAudit(ctx: Context) {
  const text = ctx.message?.text ?? "";
  const arg = text.replace(/^\/audit\s*/, "").trim();

  let msg: string;

  const window = getAuditSummaryWindow(arg);
  if (window) {
    msg = buildSummaryMessage(window.label, window.since);
  } else {
    msg = buildToolHistoryMessage(arg);
  }

  await ctx.reply(msg, { parse_mode: "Markdown" }).catch(() => ctx.reply(msg));
}
