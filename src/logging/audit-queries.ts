import { getConversationDb } from "./conversations.js";

export interface ToolUsageSummary {
  tool_name: string;
  total_calls: number;
  successful: number;
  failed: number;
  success_rate: number;
  avg_duration_ms: number;
}

export interface ToolInvocation {
  tool_name: string;
  arguments: string;
  result: string;
  success: boolean;
  duration_ms: number;
  created_at: string;
}

export interface SessionStats {
  total_sessions: number;
  total_messages: number;
  total_tool_calls: number;
}

export function getToolUsageSummary(since: string): ToolUsageSummary[] {
  const rows = getConversationDb()
    .prepare(
      `SELECT
         tool_name,
         COUNT(*) AS total_calls,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successful,
         SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
         ROUND(SUM(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) / COUNT(*) * 100, 1) AS success_rate,
         ROUND(AVG(duration_ms), 0) AS avg_duration_ms
       FROM tool_calls
       WHERE created_at >= ?
       GROUP BY tool_name
       ORDER BY total_calls DESC`,
    )
    .all(since) as unknown as ToolUsageSummary[];

  return rows;
}

export function getToolHistory(toolName: string, limit = 10): ToolInvocation[] {
  const rows = getConversationDb()
    .prepare(
      `SELECT tool_name, arguments, result, success, duration_ms, created_at
       FROM tool_calls
       WHERE tool_name = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(toolName, limit) as unknown as ToolInvocation[];

  return rows.map((r) => ({
    ...r,
    success: Boolean(r.success),
  }));
}

export function getSessionStats(since: string): SessionStats {
  const row = getConversationDb()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM sessions WHERE created_at >= ?) AS total_sessions,
         (SELECT COUNT(*) FROM messages WHERE created_at >= ?) AS total_messages,
         (SELECT COUNT(*) FROM tool_calls WHERE created_at >= ?) AS total_tool_calls`,
    )
    .get(since, since, since) as unknown as SessionStats;

  return row;
}
