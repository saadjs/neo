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
import {
  clearPerChatModelOverride,
  getPerChatModelOverride,
  refreshSessionContext,
} from "../agent";
import { getChannelConfig, upsertChannelConfig } from "../memory/db";

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
    "Manage Neo through the governed control plane: inspect status, explain settings, plan or apply safe config changes, set per-chat or channel default models, and restart the service. Use set_chat_model (not apply_config_change with COPILOT_MODEL) when asked to change the model for a specific chat or group.",
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
        "set_chat_model",
        "clear_chat_model",
      ])
      .describe("The system action to perform"),
    key: z.string().optional().describe("Managed config key for explain/plan/apply actions"),
    value: z.string().optional().describe("Desired config value for plan/apply actions"),
    reason: z.string().optional().describe("Why Neo should make the change or restart"),
    chat_id: z
      .number()
      .optional()
      .describe(
        "Telegram chat ID. Required for set_chat_model/clear_chat_model. Also used to notify after restart.",
      ),
    model: z
      .string()
      .optional()
      .describe("Model ID for set_chat_model (e.g. claude-opus-4-6, gpt-4.1)"),
    clear_override: z
      .boolean()
      .optional()
      .describe(
        "For set_chat_model: also clear any per-chat model override so the new channel default takes effect. Defaults to true.",
      ),
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

        case "set_chat_model": {
          if (!args.chat_id) {
            const result = "Error: chat_id is required for set_chat_model.";
            audit.complete(result);
            return result;
          }
          if (!args.model) {
            const result = "Error: model is required for set_chat_model.";
            audit.complete(result);
            return result;
          }

          const chatId = args.chat_id;
          const modelId = args.model;
          const clearOverride = args.clear_override !== false;

          // Set channel default model
          upsertChannelConfig(chatId, { defaultModel: modelId });

          // Clear per-chat override if requested so the channel default takes effect
          const previousOverride = getPerChatModelOverride(chatId);
          if (clearOverride && previousOverride) {
            await clearPerChatModelOverride(chatId);
          } else {
            await refreshSessionContext(chatId);
          }

          const resultPayload: Record<string, unknown> = {
            applied: true,
            chatId,
            channelDefaultModel: modelId,
            restartTriggered: false,
          };
          if (previousOverride) {
            resultPayload.previousPerChatOverride = previousOverride;
            resultPayload.perChatOverrideCleared = clearOverride;
            if (!clearOverride) {
              resultPayload.warning =
                "Per-chat override is still active and takes precedence over the channel default. Use clear_chat_model to remove it.";
            }
          }

          const result = JSON.stringify(resultPayload, null, 2);
          audit.complete(result);
          return result;
        }

        case "clear_chat_model": {
          if (!args.chat_id) {
            const result = "Error: chat_id is required for clear_chat_model.";
            audit.complete(result);
            return result;
          }

          const chatId = args.chat_id;
          const cleared: string[] = [];

          const channelCfg = getChannelConfig(chatId);
          if (channelCfg?.defaultModel) {
            upsertChannelConfig(chatId, { defaultModel: null });
            cleared.push("channel_default");
          }

          const perChatOverride = getPerChatModelOverride(chatId);
          if (perChatOverride) {
            await clearPerChatModelOverride(chatId);
            cleared.push("per_chat_override");
          } else {
            await refreshSessionContext(chatId);
          }

          const result = JSON.stringify(
            {
              applied: true,
              chatId,
              cleared,
              effectiveModel: "Will use global default after refresh.",
              restartTriggered: false,
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
