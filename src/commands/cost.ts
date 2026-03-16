import type { Context } from "grammy";
import { getTokenUsageSummary, getDailyTokenUsage, formatCostUsd } from "../logging/cost";
import { formatSqliteUtcTimestamp, startOfUtcDay } from "./reporting-time";
import { truncateTelegramMessage } from "../telegram/messages";

function formatTokens(n: number): string {
  if (n >= 100_000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

function buildTodayMessage(): string {
  const window = getCostSummaryWindow("");
  if (!window) {
    throw new Error("Expected default cost summary window");
  }
  const since = window.since;
  const summary = getTokenUsageSummary(since);

  if (summary.length === 0) {
    return `💰 Token Usage — ${window.label}\n\nNo usage recorded yet.`;
  }

  const modelWidth = Math.max(5, ...summary.map((r) => r.model.length));
  const header = `${"Model".padEnd(modelWidth)}   Input    Output    Est. Cost`;
  const rows = summary.map((r) => {
    const model = r.model.padEnd(modelWidth);
    const input = formatTokens(r.input_tokens).padStart(7);
    const output = formatTokens(r.output_tokens).padStart(7);
    const cost = formatCostUsd(r.estimated_cost_usd).padStart(9);
    return `${model}  ${input}   ${output}   ${cost}`;
  });

  const totalIn = summary.reduce((s, r) => s + r.input_tokens, 0);
  const totalOut = summary.reduce((s, r) => s + r.output_tokens, 0);
  const totalCost = summary.reduce((s, r) => s + r.estimated_cost_usd, 0);
  const table = [header, ...rows].join("\n");
  const footer = `Total: ${formatTokens(totalIn)} in / ${formatTokens(totalOut)} out ≈ ${formatCostUsd(totalCost)}`;

  return truncateTelegramMessage(
    `💰 Token Usage — ${window.label}\n\n\`\`\`\n${table}\n\`\`\`\n${footer}`,
  );
}

function buildWeekMessage(): string {
  const since = formatSqliteUtcTimestamp(new Date(Date.now() - 7 * 86_400_000));
  const daily = getDailyTokenUsage(since);

  if (daily.length === 0) {
    return "💰 Token Usage — Past 7 Days\n\nNo usage recorded yet.";
  }

  const modelWidth = Math.max(5, ...daily.map((r) => r.model.length));
  const header = `${"Date".padEnd(10)}  ${"Model".padEnd(modelWidth)}   Input    Output     Cost`;
  const rows = daily.map((r) => {
    const date = r.date.padEnd(10);
    const model = r.model.padEnd(modelWidth);
    const input = formatTokens(r.input_tokens).padStart(7);
    const output = formatTokens(r.output_tokens).padStart(7);
    const cost = formatCostUsd(r.estimated_cost_usd).padStart(8);
    return `${date}  ${model}  ${input}   ${output}   ${cost}`;
  });

  const totalIn = daily.reduce((s, r) => s + r.input_tokens, 0);
  const totalOut = daily.reduce((s, r) => s + r.output_tokens, 0);
  const totalCost = daily.reduce((s, r) => s + r.estimated_cost_usd, 0);
  const table = [header, ...rows].join("\n");
  const footer = `Total: ${formatTokens(totalIn)} in / ${formatTokens(totalOut)} out ≈ ${formatCostUsd(totalCost)}`;

  return truncateTelegramMessage(
    `💰 Token Usage — Past 7 Days\n\n\`\`\`\n${table}\n\`\`\`\n${footer}`,
  );
}

function buildMonthMessage(): string {
  const since = formatSqliteUtcTimestamp(new Date(Date.now() - 30 * 86_400_000));
  const summary = getTokenUsageSummary(since);

  if (summary.length === 0) {
    return "💰 Token Usage — Past 30 Days\n\nNo usage recorded yet.";
  }

  const modelWidth = Math.max(5, ...summary.map((r) => r.model.length));
  const header = `${"Model".padEnd(modelWidth)}    Input     Output    Est. Cost`;
  const rows = summary.map((r) => {
    const model = r.model.padEnd(modelWidth);
    const input = formatTokens(r.input_tokens).padStart(8);
    const output = formatTokens(r.output_tokens).padStart(8);
    const cost = formatCostUsd(r.estimated_cost_usd).padStart(9);
    return `${model}   ${input}    ${output}   ${cost}`;
  });

  const totalIn = summary.reduce((s, r) => s + r.input_tokens, 0);
  const totalOut = summary.reduce((s, r) => s + r.output_tokens, 0);
  const totalCost = summary.reduce((s, r) => s + r.estimated_cost_usd, 0);
  const table = [header, ...rows].join("\n");
  const footer = `Total: ${formatTokens(totalIn)} in / ${formatTokens(totalOut)} out ≈ ${formatCostUsd(totalCost)}`;

  return truncateTelegramMessage(
    `💰 Token Usage — Past 30 Days\n\n\`\`\`\n${table}\n\`\`\`\n${footer}`,
  );
}

export async function handleCost(ctx: Context) {
  const text = ctx.message?.text ?? "";
  const arg = text.replace(/^\/cost\s*/, "").trim();

  let msg: string;

  if (arg === "week") {
    msg = buildWeekMessage();
  } else if (arg === "month") {
    msg = buildMonthMessage();
  } else {
    msg = buildTodayMessage();
  }

  await ctx.reply(msg, { parse_mode: "Markdown" }).catch(() => ctx.reply(msg));
}

export function getCostSummaryWindow(
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

  if (arg === "month") {
    return {
      label: "Past 30 Days",
      since: formatSqliteUtcTimestamp(new Date(now.getTime() - 30 * 86_400_000)),
    };
  }

  return null;
}
