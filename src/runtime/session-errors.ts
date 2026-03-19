import { PendingUserInputCancelledError } from "../transport/user-input";

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
