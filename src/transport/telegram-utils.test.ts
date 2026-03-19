import { describe, expect, it } from "vitest";
import {
  createTelegramConversationRef,
  getTelegramChatId,
  getTelegramConversationKind,
} from "./telegram-utils";

describe("getTelegramConversationKind", () => {
  it("maps group and supergroup to group", () => {
    expect(getTelegramConversationKind("group")).toBe("group");
    expect(getTelegramConversationKind("supergroup")).toBe("group");
  });

  it("maps channel to channel", () => {
    expect(getTelegramConversationKind("channel")).toBe("channel");
  });

  it("defaults to dm for private and unknown types", () => {
    expect(getTelegramConversationKind("private")).toBe("dm");
    expect(getTelegramConversationKind(undefined)).toBe("dm");
  });
});

describe("createTelegramConversationRef", () => {
  it("builds a normalized ref from a Telegram chat object", () => {
    const ref = createTelegramConversationRef({
      id: -100123,
      type: "supergroup",
      title: "Dev Chat",
    });

    expect(ref).toEqual({
      platform: "telegram",
      id: "-100123",
      kind: "group",
      title: "Dev Chat",
      metadata: {
        telegramChatId: -100123,
        sessionScopeId: -100123,
        telegramChatType: "supergroup",
      },
    });
  });

  it("uses username as title fallback for DMs", () => {
    const ref = createTelegramConversationRef({ id: 42, type: "private", username: "saad" });
    expect(ref.title).toBe("saad");
    expect(ref.kind).toBe("dm");
  });
});

describe("getTelegramChatId", () => {
  it("extracts numeric chat id from metadata", () => {
    const ref = createTelegramConversationRef({ id: -100999 });
    expect(getTelegramChatId(ref)).toBe(-100999);
  });

  it("falls back to parsing the string id", () => {
    expect(getTelegramChatId({ platform: "telegram", id: "-100999", kind: "group" })).toBe(-100999);
  });

  it("throws for non-numeric conversation ids without metadata", () => {
    expect(() =>
      getTelegramChatId({ platform: "discord", id: "abc-channel", kind: "channel" }),
    ).toThrow("not a Telegram chat id");
  });
});
