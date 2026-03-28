const notifiedSessionIds = new Set<string>();
const sessionErrorSummaries = new Map<string, import("../session-errors").SessionErrorSummary>();
const attemptedFallbackModels = new Map<number, Set<string>>();
const pendingFailovers = new Map<
  number,
  {
    fromModel: string;
    toModel: string;
    attemptedModels: string[];
  }
>();

export function markSessionErrorNotified(sessionId: string) {
  notifiedSessionIds.add(sessionId);
}

export function consumeSessionErrorNotified(sessionId: string): boolean {
  if (!notifiedSessionIds.has(sessionId)) return false;
  notifiedSessionIds.delete(sessionId);
  return true;
}

export function storeSessionErrorSummary(
  sessionId: string,
  summary: import("../session-errors").SessionErrorSummary,
) {
  sessionErrorSummaries.set(sessionId, summary);
}

export function consumeSessionErrorSummary(sessionId: string) {
  const summary = sessionErrorSummaries.get(sessionId);
  if (!summary) return null;
  sessionErrorSummaries.delete(sessionId);
  return summary;
}

export function markFallbackModelAttempted(chatId: number, modelId: string) {
  const attempted = attemptedFallbackModels.get(chatId) ?? new Set<string>();
  attempted.add(modelId);
  attemptedFallbackModels.set(chatId, attempted);
}

export function getAttemptedFallbackModels(chatId: number): string[] {
  return [...(attemptedFallbackModels.get(chatId) ?? new Set<string>())];
}

export function clearFallbackAttemptState(chatId: number) {
  attemptedFallbackModels.delete(chatId);
  pendingFailovers.delete(chatId);
}

export function storePendingFailover(
  chatId: number,
  directive: {
    fromModel: string;
    toModel: string;
    attemptedModels: string[];
  },
) {
  pendingFailovers.set(chatId, directive);
}

export function consumePendingFailover(chatId: number) {
  const directive = pendingFailovers.get(chatId);
  if (!directive) return null;
  pendingFailovers.delete(chatId);
  return directive;
}
