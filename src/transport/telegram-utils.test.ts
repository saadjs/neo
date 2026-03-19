import { describe, expect, it } from "vitest";
import {
  createTelegramConversationRef,
  createTelegramConversationRefFromId,
  getTelegramChatId,
  getTelegramConversationKind,
  isChannelChat,
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

describe("isChannelChat", () => {
  it("returns true for negative (group/channel) chat IDs", () => {
    expect(isChannelChat("-100123")).toBe(true);
  });

  it("returns false for positive (DM) chat IDs", () => {
    expect(isChannelChat("42")).toBe(false);
    expect(isChannelChat("1")).toBe(false);
  });
});

describe("createTelegramConversationRefFromId", () => {
  it("creates a DM ref from a string chat ID without unsafe Number conversion", () => {
    const ref = createTelegramConversationRefFromId("123");
    expect(ref).toEqual({
      platform: "telegram",
      id: "123",
      kind: "dm",
      metadata: { sessionScopeId: "123" },
    });
  });

  it("preserves the original string ID for negative chat IDs", () => {
    const ref = createTelegramConversationRefFromId("-100999");
    expect(ref.id).toBe("-100999");
    expect(ref.metadata?.sessionScopeId).toBe("-100999");
  });
});
