import { describe, expect, it } from "vitest";
import { shouldSilenceSessionError } from "./session-errors.js";
import { PendingUserInputCancelledError } from "./user-input.js";

describe("shouldSilenceSessionError", () => {
  it("silences cancelled ask_user prompts", () => {
    expect(
      shouldSilenceSessionError(new PendingUserInputCancelledError("cancelled"), {
        hasActiveSession: false,
        isTrackedSession: false,
        clientState: "connected",
      }),
    ).toBe(true);
  });

  it("silences intentionally replaced tracked sessions while connected", () => {
    expect(
      shouldSilenceSessionError(new Error("stale session"), {
        hasActiveSession: true,
        isTrackedSession: false,
        clientState: "connected",
      }),
    ).toBe(true);
  });

  it("does not silence connection-loss failures", () => {
    expect(
      shouldSilenceSessionError(new Error("connection lost"), {
        hasActiveSession: true,
        isTrackedSession: false,
        clientState: "disconnected",
      }),
    ).toBe(false);
  });
});
