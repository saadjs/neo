import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import * as os from "node:os";
import { createAuditTimer } from "../logging/audit";
import { getManagedConfigDefinition, isManagedConfigKey } from "../config";
import {
  applyConfigChange,
  explainSetting,
  formatSystemStatusSummary,
  getRecentChanges,
  getRecentRestarts,
  getSystemStatus,
  planConfigChange,
  restartService,
} from "../runtime/state";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

export const systemTool = defineTool("system", {
  description:
    "Manage Neo through the governed control plane: inspect status, explain settings, plan or apply safe config changes, and restart the service.",
  parameters: z.object({
    action: z
      .enum([
        "info",
        "status",
        "explain_setting",
        "plan_config_change",
        "apply_config_change",
        "restart_service",
        "recent_changes",
        "recent_restarts",
        "uptime",
      ])
      .describe("The system action to perform"),
    key: z.string().optional().describe("Managed config key for explain/plan/apply actions"),
    value: z.string().optional().describe("Desired config value for plan/apply actions"),
    reason: z.string().optional().describe("Why Neo should make the change or restart"),
    chat_id: z.string().optional().describe("Chat ID to notify after restart"),
    allow_approval_required: z
      .boolean()
      .optional()
      .describe("Override the auto-apply allowlist for approval-required settings"),
  }),
  handler: async (args, invocation) => {
    const auditArgs =
      args.key && isManagedConfigKey(args.key) && getManagedConfigDefinition(args.key).redact
        ? { ...args, value: args.value ? "[REDACTED]" : args.value }
        : args;
    const audit = createAuditTimer(
      invocation.sessionId,
      "system",
      auditArgs as Record<string, unknown>,
    );

    try {
      switch (args.action) {
        case "info": {
          const info = {
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
            freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
            systemUptime: formatUptime(os.uptime()),
            nodeVersion: process.version,
            processUptime: formatUptime(process.uptime()),
          };
          const result = JSON.stringify(info, null, 2);
          audit.complete(result);
          return result;
        }

        case "status": {
          const status = await getSystemStatus();
          const result = JSON.stringify(
            {
              summary: formatSystemStatusSummary(status),
              ...status,
            },
            null,
            2,
          );
          audit.complete(result);
          return result;
        }

        case "explain_setting": {
          if (!args.key || !isManagedConfigKey(args.key)) {
            const result = "Error: key must be a managed config key.";
            audit.complete(result);
            return result;
          }
          const result = JSON.stringify(await explainSetting(args.key), null, 2);
          audit.complete(result);
          return result;
        }

        case "plan_config_change": {
          if (!args.key || !isManagedConfigKey(args.key) || args.value === undefined) {
            const result = "Error: key and value are required for plan_config_change.";
            audit.complete(result);
            return result;
          }
          const result = JSON.stringify(
            await planConfigChange({
              key: args.key,
              value: args.value,
              actor: "agent",
              source: "tool",
              reason: args.reason ?? "No reason provided.",
            }),
            null,
            2,
          );
          audit.complete(result);
          return result;
        }

        case "apply_config_change": {
          if (!args.key || !isManagedConfigKey(args.key) || args.value === undefined) {
            const result = "Error: key and value are required for apply_config_change.";
            audit.complete(result);
            return result;
          }
          const result = JSON.stringify(
            await applyConfigChange({
              key: args.key,
              value: args.value,
              actor: "agent",
              source: "tool",
              reason: args.reason ?? "No reason provided.",
              allowApprovalRequired: args.allow_approval_required,
            }),
            null,
            2,
          );
          audit.complete(result);
          return result;
        }

        case "restart_service": {
          const result = JSON.stringify(
            await restartService({
              actor: "agent",
              source: "tool",
              reason: args.reason ?? "Agent-triggered restart.",
              chatId: args.chat_id,
            }),
            null,
            2,
          );
          audit.complete(result);
          return result;
        }

        case "recent_changes": {
          const result = JSON.stringify(await getRecentChanges(), null, 2);
          audit.complete(result);
          return result;
        }

        case "recent_restarts": {
          const result = JSON.stringify(await getRecentRestarts(), null, 2);
          audit.complete(result);
          return result;
        }

        case "uptime": {
          const result = JSON.stringify(
            {
              processUptime: formatUptime(process.uptime()),
              systemUptime: formatUptime(os.uptime()),
            },
            null,
            2,
          );
          audit.complete(result);
          return result;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      audit.complete(`Error: ${message}`);
      throw error;
    }
  },
});
