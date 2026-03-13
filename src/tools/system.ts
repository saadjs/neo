import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import * as os from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { config } from "../config.js";
import { setLogLevel } from "../logging/index.js";
import { createAuditTimer } from "../logging/audit.js";
import { switchModel, getClient, getChatIdForSession } from "../agent.js";

const LOG_LEVELS = ["error", "warn", "info", "debug", "trace"] as const;

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
    "Manage the Neo system: retrieve system info, restart the process, change log level, check uptime, switch model, or list available models.",
  parameters: z.object({
    action: z
      .enum(["info", "restart", "set_log_level", "uptime", "switch_model", "list_models"])
      .describe("The system action to perform"),
    log_level: z
      .enum(LOG_LEVELS)
      .optional()
      .describe("Target log level (required for set_log_level action)"),
    model: z
      .string()
      .optional()
      .describe("Model ID to switch to (required for switch_model action)"),
    chat_id: z
      .number()
      .optional()
      .describe("Chat ID for model switch (required for switch_model action)"),
  }),
  handler: async (args, invocation) => {
    const audit = createAuditTimer(invocation.sessionId, "system", args as Record<string, unknown>);

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

        case "restart": {
          const marker = join(config.paths.data, ".restart-marker");
          await writeFile(marker, new Date().toISOString(), "utf-8");
          const result = "Restart marker written. Process will exit in 500ms.";
          audit.complete(result);
          setTimeout(() => process.exit(0), 500);
          return result;
        }

        case "set_log_level": {
          if (!args.log_level) {
            const result = "Error: log_level is required for set_log_level action.";
            audit.complete(result);
            return result;
          }
          setLogLevel(args.log_level);
          const result = `Log level set to "${args.log_level}".`;
          audit.complete(result);
          return result;
        }

        case "uptime": {
          const result = `Process uptime: ${formatUptime(process.uptime())}`;
          audit.complete(result);
          return result;
        }

        case "switch_model": {
          if (!args.model) {
            const result = "Error: model is required for switch_model action.";
            audit.complete(result);
            return result;
          }
          const chatId = args.chat_id ?? getChatIdForSession(invocation.sessionId);
          if (!chatId) {
            const result = "Error: could not resolve chat for this session.";
            audit.complete(result);
            return result;
          }
          await switchModel(chatId, args.model);
          const result = `Model switched to "${args.model}".`;
          audit.complete(result);
          return result;
        }

        case "list_models": {
          const client = getClient();
          if (!client) {
            const result = "Error: agent not started.";
            audit.complete(result);
            return result;
          }
          const models = await client.listModels();
          const result = models.map((m) => `${m.id} — ${m.name}`).join("\n");
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
