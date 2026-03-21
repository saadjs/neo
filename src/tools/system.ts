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
  switchModel,
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
    scope: z
      .enum(["channel", "chat"])
      .optional()
      .describe(
        'For set_chat_model: "channel" sets the group default model (use for group chats), "chat" sets a per-chat override (use for DMs or temporary switches). Defaults to "channel". For clear_chat_model: "channel" clears the channel default, "chat" clears the per-chat override, omit to clear the per-chat override first (if it exists) or the channel default otherwise.',
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
          const scope = args.scope ?? "channel";

          if (scope === "chat") {
            // Per-chat override (like /model) — temporary, chat-specific
            const previousOverride = getPerChatModelOverride(chatId);
            await switchModel(chatId, modelId);

            const result = JSON.stringify(
              {
                applied: true,
                chatId,
                scope: "chat",
                perChatModel: modelId,
                previousPerChatModel: previousOverride ?? null,
                restartTriggered: false,
              },
              null,
              2,
            );
            audit.complete(result);
            return result;
          }

          // scope === "channel" — set channel default model
          upsertChannelConfig(chatId, { defaultModel: modelId });

          // Clear per-chat override so the new channel default takes effect
          const previousOverride = getPerChatModelOverride(chatId);
          if (previousOverride) {
            await clearPerChatModelOverride(chatId);
          } else {
            await refreshSessionContext(chatId);
          }

          const resultPayload: Record<string, unknown> = {
            applied: true,
            chatId,
            scope: "channel",
            channelDefaultModel: modelId,
            restartTriggered: false,
          };
          if (previousOverride) {
            resultPayload.previousPerChatOverride = previousOverride;
            resultPayload.perChatOverrideCleared = true;
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

          const clearChatId = args.chat_id;
          const clearScope = args.scope;
          const cleared: string[] = [];

          if (clearScope === "channel") {
            // Explicitly clear only the channel default
            const channelCfg = getChannelConfig(clearChatId);
            if (channelCfg?.defaultModel) {
              upsertChannelConfig(clearChatId, { defaultModel: null });
              cleared.push("channel_default");
            }
            await refreshSessionContext(clearChatId);
          } else if (clearScope === "chat") {
            // Explicitly clear only the per-chat override
            const perChatOverride = getPerChatModelOverride(clearChatId);
            if (perChatOverride) {
              await clearPerChatModelOverride(clearChatId);
              cleared.push("per_chat_override");
            } else {
              await refreshSessionContext(clearChatId);
            }
          } else {
            // No scope specified: clear per-chat override first (most specific),
            // fall back to clearing channel default if no override exists
            const perChatOverride = getPerChatModelOverride(clearChatId);
            if (perChatOverride) {
              await clearPerChatModelOverride(clearChatId);
              cleared.push("per_chat_override");
            } else {
              const channelCfg = getChannelConfig(clearChatId);
              if (channelCfg?.defaultModel) {
                upsertChannelConfig(clearChatId, { defaultModel: null });
                cleared.push("channel_default");
              }
              await refreshSessionContext(clearChatId);
            }
          }

          const result = JSON.stringify(
            {
              applied: true,
              chatId: clearChatId,
              cleared,
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
