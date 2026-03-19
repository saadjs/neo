import type { PreToolUseHandler } from "./types";
import { getLogger } from "../logging/index";
import { isJobRunning } from "../scheduler/job-runner";

export function preToolUse(chatId: string): PreToolUseHandler {
  return (input) => {
    const log = getLogger();
    log.debug({ chatId, tool: input.toolName, args: input.toolArgs }, "hook:pre-tool-use");

    if (
      input.toolName === "system" &&
      typeof input.toolArgs === "object" &&
      input.toolArgs !== null &&
      (input.toolArgs as Record<string, unknown>).action === "restart_service" &&
      isJobRunning()
    ) {
      log.warn({ chatId }, "Denied restart_service — a scheduled job is currently running");
      return {
        permissionDecision: "deny" as const,
        permissionDecisionReason:
          "A scheduled job is currently executing. Restarting the service now would kill the in-flight job. Wait until the job completes before restarting.",
      };
    }
  };
}
