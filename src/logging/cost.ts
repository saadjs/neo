import { getConversationDb } from "./conversations";

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "claude-sonnet-4": { input: 3.0, output: 15.0 },
  "o3-mini": { input: 1.1, output: 4.4 },
};

export function initTokenUsageTable(): void {
  const db = getConversationDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
    CREATE INDEX IF NOT EXISTS idx_token_usage_created ON token_usage(created_at);
  `);
}

export function recordCompactionTokens(opts: {
  sessionId: string;
  model: string;
  preCompactionTokens?: number;
  postCompactionTokens?: number;
}): void {
  getConversationDb()
    .prepare(
      `INSERT INTO token_usage (session_id, event_type, model, input_tokens, output_tokens)
       VALUES (?, 'compaction', ?, ?, ?)`,
    )
    .run(opts.sessionId, opts.model, opts.preCompactionTokens ?? 0, opts.postCompactionTokens ?? 0);
}

export function recordMessageEstimate(opts: {
  sessionId: string;
  model: string;
  role: "user" | "assistant";
  content: string;
}): void {
  const tokens = Math.ceil(opts.content.length / 4);
  const inputTokens = opts.role === "user" ? tokens : 0;
  const outputTokens = opts.role === "assistant" ? tokens : 0;

  getConversationDb()
    .prepare(
      `INSERT INTO token_usage (session_id, event_type, model, input_tokens, output_tokens)
       VALUES (?, 'message_estimate', ?, ?, ?)`,
    )
    .run(opts.sessionId, opts.model, inputTokens, outputTokens);
}

export interface TokenUsageSummary {
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export interface DailyTokenUsage {
  date: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export function getTokenUsageSummary(since: string): TokenUsageSummary[] {
  const rows = getConversationDb()
    .prepare(
      `SELECT model, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
       FROM token_usage
       WHERE created_at >= ?
       GROUP BY model`,
    )
    .all(since) as unknown as { model: string; input_tokens: number; output_tokens: number }[];

  return rows.map((row) => ({
    model: row.model,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    estimated_cost_usd: estimateCost(row.model, row.input_tokens, row.output_tokens),
  }));
}

export function getDailyTokenUsage(since: string): DailyTokenUsage[] {
  const rows = getConversationDb()
    .prepare(
      `SELECT date(created_at) AS date, model,
              SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
       FROM token_usage
       WHERE created_at >= ?
       GROUP BY date, model
       ORDER BY date DESC`,
    )
    .all(since) as unknown as {
    date: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
  }[];

  return rows.map((row) => ({
    date: row.date,
    model: row.model,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    estimated_cost_usd: estimateCost(row.model, row.input_tokens, row.output_tokens),
  }));
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export function formatCostUsd(amount: number): string {
  if (amount < 0.01) return "<$0.01";
  return `$${amount.toFixed(2)}`;
}
