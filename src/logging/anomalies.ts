import type { DatabaseSync } from "node:sqlite";
import { getConversationDb } from "./conversations.js";
import {
  ANOMALY_RECENT_CALLS,
  ANOMALY_FAILURE_THRESHOLD,
  ANOMALY_ERROR_MAX_CHARS,
} from "../constants.js";

export interface ToolAnomaly {
  tool_name: string;
  consecutive_failures: number;
  last_failure_at: string;
  last_error: string;
}

/**
 * Detect tools with 3+ consecutive recent failures.
 * Looks at the last 5 calls per tool and checks if the most recent ones are all failures.
 */
export function detectToolAnomalies(db?: DatabaseSync): ToolAnomaly[] {
  const conn = db ?? getConversationDb();

  // Get distinct tool names that have had at least one failure in the last 24 hours
  const tools = conn
    .prepare(
      `SELECT DISTINCT tool_name FROM tool_calls
       WHERE success = 0 AND created_at >= datetime('now', '-1 day')`,
    )
    .all() as unknown as Array<{ tool_name: string }>;

  const anomalies: ToolAnomaly[] = [];

  for (const { tool_name } of tools) {
    // Get the last 5 calls for this tool
    const recent = conn
      .prepare(
        `SELECT success, result, created_at FROM tool_calls
         WHERE tool_name = ? AND success IS NOT NULL
         ORDER BY created_at DESC LIMIT ${ANOMALY_RECENT_CALLS}`,
      )
      .all(tool_name) as unknown as Array<{
      success: number;
      result: string | null;
      created_at: string;
    }>;

    // Count consecutive failures from the most recent
    let consecutive = 0;
    for (const call of recent) {
      if (call.success === 0) {
        consecutive++;
      } else {
        break;
      }
    }

    if (consecutive >= ANOMALY_FAILURE_THRESHOLD) {
      anomalies.push({
        tool_name,
        consecutive_failures: consecutive,
        last_failure_at: recent[0].created_at,
        last_error: (recent[0].result ?? "unknown error").slice(0, ANOMALY_ERROR_MAX_CHARS),
      });
    }
  }

  return anomalies;
}

/**
 * Format anomalies into a string suitable for inclusion in system context.
 * Returns empty string if no anomalies detected.
 */
export function formatAnomaliesForContext(db?: DatabaseSync): string {
  const anomalies = detectToolAnomalies(db);
  if (anomalies.length === 0) return "";

  let msg = "## ⚠️ Tool Health Alerts\n\n";
  msg +=
    "The following tools have been failing repeatedly. Mention this to the user if relevant:\n\n";
  for (const a of anomalies) {
    msg += `- **${a.tool_name}**: ${a.consecutive_failures} consecutive failures (last: ${a.last_failure_at})\n`;
    msg += `  Last error: ${a.last_error}\n`;
  }
  return msg;
}
