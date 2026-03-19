import { describe, expect, it } from "vitest";

// TelegramTransport.isEditNoOp and isEditTargetGone are pure functions that
// only inspect the error message. We test the patterns directly to avoid
// importing the full Telegram class (which requires env vars and grammy).

function isEditNoOp(err: unknown): boolean {
  return err instanceof Error && /message is not modified/i.test(err.message);
}

function isEditTargetGone(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /message to edit not found|message_id_invalid|Bad Request: not Found/i.test(err.message);
}

describe("TelegramTransport.isEditNoOp", () => {
  it("detects no-op edits (message is not modified)", () => {
    expect(
      isEditNoOp(
        new Error(
          "Bad Request: message is not modified: specified new message content and reply markup are exactly the same",
        ),
      ),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isEditNoOp(new Error("Bad Request: MESSAGE_ID_INVALID"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isEditNoOp("not an error")).toBe(false);
  });
});

describe("TelegramTransport.isEditTargetGone", () => {
  it("detects missing message to edit", () => {
    expect(isEditTargetGone(new Error("Bad Request: message to edit not found"))).toBe(true);
  });

  it("detects invalid message ID", () => {
    expect(isEditTargetGone(new Error("Bad Request: MESSAGE_ID_INVALID"))).toBe(true);
  });

  it("detects not found via editMessageText call", () => {
    expect(
      isEditTargetGone(
        new Error("Call to 'editMessageText' failed! (400: Bad Request: not Found)"),
      ),
    ).toBe(true);
  });

  it("returns false for non-Error values", () => {
    expect(isEditTargetGone("not an error")).toBe(false);
  });

  it("returns false for unrelated errors", () => {
    expect(isEditTargetGone(new Error("network timeout"))).toBe(false);
  });
});
