import type { SessionEndHandler } from "./types";
import { getLogger } from "../logging/index";
import { cancelPendingUserInputForSession } from "../telegram/user-input";
import { storeSessionErrorSummary } from "./error-state";
import { summarizeSessionError } from "../session-errors";

export function sessionEnd(chatId: number): SessionEndHandler {
  return async (input, invocation) => {
    const log = getLogger();

    if (input.reason === "complete" && input.finalMessage) {
      log.info({ chatId, summaryLength: input.finalMessage.length }, "hook:session-end complete");
    }

    if (input.reason === "error") {
      log.warn({ chatId, error: input.error }, "hook:session-end error");
      const summary = summarizeSessionError(input.error);
      if (summary) {
        storeSessionErrorSummary(invocation.sessionId, summary);
      }
    }

    if (input.reason !== "complete") {
      await cancelPendingUserInputForSession(
        chatId,
        invocation.sessionId,
        "The pending question was cancelled because the session ended.",
      );
    }
  };
}
