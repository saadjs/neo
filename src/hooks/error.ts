import type { ErrorOccurredHandler } from "./types";
import { getLogger } from "../logging/index";
import { markSessionErrorNotified } from "./error-state";

export function errorOccurred(chatId: number): ErrorOccurredHandler {
  return async (input, invocation) => {
    const log = getLogger();
    log.warn(
      { chatId, error: input.error, context: input.errorContext, recoverable: input.recoverable },
      "hook:error-occurred",
    );

    if (input.errorContext === "model_call" && input.recoverable) {
      return { errorHandling: "retry" as const, retryCount: 2 };
    }

    if (!input.recoverable && input.errorContext !== "tool_execution") {
      markSessionErrorNotified(invocation.sessionId);
      return {
        errorHandling: "abort" as const,
        userNotification: `\u26a0\ufe0f Neo encountered a non-recoverable error: ${input.error}`,
      };
    }
  };
}
