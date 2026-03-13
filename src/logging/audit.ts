import { getLogger } from "./index.js";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

const auditPath = join(config.paths.logs, "audit.log");
mkdirSync(config.paths.logs, { recursive: true });

export interface AuditEntry {
  timestamp: string;
  sessionId: string;
  tool: string;
  params: Record<string, unknown>;
  result: string;
  durationMs: number;
}

export function logAudit(entry: AuditEntry) {
  const log = getLogger();
  log.info({ audit: true, ...entry }, `tool:${entry.tool}`);

  const line = JSON.stringify(entry) + "\n";
  try {
    appendFileSync(auditPath, line);
  } catch {
    log.error(`Failed to write audit log to ${auditPath}`);
  }
}

export function createAuditTimer(sessionId: string, tool: string, params: Record<string, unknown>) {
  const start = performance.now();
  return {
    complete(result: string) {
      logAudit({
        timestamp: new Date().toISOString(),
        sessionId,
        tool,
        params,
        result: result.slice(0, 500),
        durationMs: Math.round(performance.now() - start),
      });
    },
  };
}
