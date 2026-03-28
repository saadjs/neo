const notifiedSessionIds = new Set<string>();
const sessionErrorSummaries = new Map<string, import("../session-errors").SessionErrorSummary>();

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
