import { describe, expect, it } from "vitest";
import { isMessageNotModifiedError, isMissingProgressMessageError } from "./session-timeout.js";

describe("progress message helpers", () => {
  it("detects missing Telegram progress messages", () => {
    expect(isMissingProgressMessageError(new Error("Bad Request: message to edit not found"))).toBe(
      true,
    );
    expect(isMissingProgressMessageError(new Error("Bad Request: MESSAGE_ID_INVALID"))).toBe(true);
  });

  it("detects no-op edits separately", () => {
    expect(
      isMessageNotModifiedError(
        new Error(
          "Bad Request: message is not modified: specified new message content and reply markup are exactly the same",
        ),
      ),
    ).toBe(true);
    expect(isMessageNotModifiedError(new Error("Bad Request: MESSAGE_ID_INVALID"))).toBe(false);
  });
});
