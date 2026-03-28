import type { ErrorOccurredHandler } from "./types";
import { getLogger } from "../logging/index";
import { getModelForChat } from "../agent";
import { getNextFallbackModel } from "../commands/model-catalog";
import {
  getAttemptedFallbackModels,
  storePendingFailover,
  clearFallbackAttemptState,
} from "./error-state";

function serializeError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }
  const obj = error as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const key of ["message", "name", "stack", "code", "status", "statusCode", "error", "type"]) {
    if (key in obj && obj[key] !== undefined) {
      fields[key] = obj[key];
    }
  }
  for (const key of Object.keys(obj)) {
    if (!(key in fields)) {
      fields[key] = obj[key];
    }
  }
  if (Object.keys(fields).length > 0) return fields;
  return { raw: String(error) };
}

function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const obj = error as Record<string, unknown>;
  // Only retry if we can confirm a transient error (timeout, rate limit, etc.)
  const message = typeof obj.message === "string" ? obj.message : "";
  const code = typeof obj.code === "string" ? obj.code : "";
  return /timeout|ETIMEDOUT|ECONNRESET|rate.limit|429|503|502/i.test(`${message} ${code}`);
}

const modelCallFailures = new Map<string, number>();

export function resetModelCallFailures(sessionId: string): void {
  modelCallFailures.delete(sessionId);
}

export function errorOccurred(chatId: number): ErrorOccurredHandler {
  return async (input, invocation) => {
    const log = getLogger();
    log.warn(
      {
        chatId,
        error: serializeError(input.error),
        context: input.errorContext,
        recoverable: input.recoverable,
      },
      "hook:error-occurred",
    );

    if (input.errorContext === "model_call" && input.recoverable) {
      // Only retry transient errors we can identify; abort immediately for
      // opaque errors (e.g. auth failures from BYOK providers where the SDK
      // passes an empty {} error object).
      if (!isTransientError(input.error)) {
        resetModelCallFailures(invocation.sessionId);
        return { errorHandling: "abort" as const };
      }

      const key = invocation.sessionId;
      const count = (modelCallFailures.get(key) ?? 0) + 1;
      modelCallFailures.set(key, count);

      if (count <= 2) {
        return { errorHandling: "retry" as const };
      }

      const currentModel = getModelForChat(chatId);
      const attemptedModels = getAttemptedFallbackModels(chatId);
      const nextModel = await getNextFallbackModel(currentModel, attemptedModels);

      if (nextModel) {
        storePendingFailover(chatId, {
          fromModel: currentModel,
          toModel: nextModel,
          attemptedModels,
        });
      }

      // Retries exhausted — abort so the bot layer can either fail over or surface the error
      resetModelCallFailures(key);
      return { errorHandling: "abort" as const };
    }

    // Reset counter on non-model-call events
    resetModelCallFailures(invocation.sessionId);
    if (input.errorContext !== "model_call") {
      clearFallbackAttemptState(chatId);
    }

    if (!input.recoverable && input.errorContext !== "tool_execution") {
      return { errorHandling: "abort" as const };
    }
  };
}
