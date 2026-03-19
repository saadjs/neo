import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTransport,
  notifyPhoto,
  notifyText,
  registerTransport,
  unregisterTransport,
} from "./notifier";
import type { OutboundTransport } from "./types";

function createTransport(): OutboundTransport {
  return {
    platform: "telegram",
    capabilities: {
      editableMessages: true,
      typingIndicators: true,
      commands: true,
      interactiveInput: true,
      photoDelivery: true,
      voiceMessages: true,
    },
    sendText: vi.fn(async () => ({ id: "1" })),
    editText: vi.fn(async () => {}),
    deleteMessage: vi.fn(async () => {}),
    indicateTyping: vi.fn(async () => {}),
    sendPhoto: vi.fn(async () => ({ id: "2" })),
    requestUserInput: vi.fn(async () => ({ id: "3" })),
    clearUserInputPrompt: vi.fn(async () => {}),
  };
}

afterEach(() => {
  unregisterTransport("telegram");
});

describe("notifier", () => {
  it("routes text and photo notifications through the registered transport", async () => {
    const transport = createTransport();
    registerTransport(transport);

    const target = {
      conversation: {
        platform: "telegram" as const,
        id: "123",
        kind: "dm" as const,
      },
    };

    await notifyText(target, "hello");
    await notifyPhoto(target, "/tmp/test.png", "caption");

    expect(getTransport("telegram")).toBe(transport);
    expect(transport.sendText).toHaveBeenCalledWith(target.conversation, "hello");
    expect(transport.sendPhoto).toHaveBeenCalledWith(target.conversation, "/tmp/test.png", {
      caption: "caption",
    });
  });

  it("throws when no transport is registered for the target platform", async () => {
    const target = {
      conversation: {
        platform: "discord" as const,
        id: "456",
        kind: "dm" as const,
      },
    };

    await expect(notifyText(target, "hello")).rejects.toThrow(
      "No transport registered for discord.",
    );
  });

  it("removes a transport on unregister", () => {
    const transport = createTransport();
    registerTransport(transport);
    expect(getTransport("telegram")).toBe(transport);

    unregisterTransport("telegram");
    expect(getTransport("telegram")).toBeUndefined();
  });
});
