const notifiedSessionIds = new Set<string>();

export function markSessionErrorNotified(sessionId: string) {
  notifiedSessionIds.add(sessionId);
}

export function consumeSessionErrorNotified(sessionId: string): boolean {
  if (!notifiedSessionIds.has(sessionId)) return false;
  notifiedSessionIds.delete(sessionId);
  return true;
}
