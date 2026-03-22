import type { PreToolUseHandler } from "./types";
import { getLogger } from "../logging/index";
import { isJobRunning } from "../scheduler/job-runner";

const JOB_RUNNING_DENY_REASON =
  "A scheduled job is currently executing. Restarting the service now would kill the in-flight job. Wait until the job completes before restarting.";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches a command position: start-of-string or after a shell separator (&&, ||, ;, |, $(...))
const CMD_BOUNDARY = String.raw`(?:^|[;&|]\s*|\$\(\s*)`;

function bashCommandTriggersRestart(args: unknown, serviceUnit: string): boolean {
  if (!args || typeof args !== "object") return false;
  const command = (args as Record<string, unknown>).command;
  if (typeof command !== "string") return false;

  const unit = escapeRegExp(serviceUnit);
  const patterns = [
    new RegExp(CMD_BOUNDARY + String.raw`(?:\./)?(?:\S+/)?deploy/update\.sh`),
    new RegExp(CMD_BOUNDARY + String.raw`systemctl\s+(--user\s+)?(restart|stop)\s+` + unit),
  ];
  return patterns.some((pat) => pat.test(command));
}

export function preToolUse(chatId: number, serviceUnit: string): PreToolUseHandler {
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
        permissionDecisionReason: JOB_RUNNING_DENY_REASON,
      };
    }

    if (input.toolName === "bash" && bashCommandTriggersRestart(input.toolArgs, serviceUnit)) {
      if (isJobRunning()) {
        log.warn({ chatId }, "Denied bash restart — a scheduled job is currently running");
        return {
          permissionDecision: "deny" as const,
          permissionDecisionReason: JOB_RUNNING_DENY_REASON,
        };
      }

      log.info({ chatId }, "Bash command will trigger service restart");
      return {
        additionalContext:
          "WARNING: This command will restart the Neo service. " +
          "The current session will be terminated and the user will see a brief interruption. " +
          "Before running this command, send a message telling the user what you're about to do " +
          "and that you'll be back online shortly after the restart. " +
          "The user will NOT see any tool output after the restart completes.",
      };
    }
  };
}
