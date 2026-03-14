import { PendingUserInputCancelledError } from "./user-input.js";

export function shouldSilenceSessionError(
  err: unknown,
  options: {
    hasActiveSession: boolean;
    isTrackedSession: boolean;
    clientState: string | undefined;
  },
): boolean {
  if (err instanceof PendingUserInputCancelledError) {
    return true;
  }

  if (!options.hasActiveSession) {
    return false;
  }

  return options.clientState === "connected" && !options.isTrackedSession;
}
