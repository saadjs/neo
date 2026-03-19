import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../logging/index.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { ConversationRef, OutboundTransport } from "./types";
import {
  PendingUserInputCancelledError,
  cancelAllPendingUserInputs,
  cancelPendingUserInput,
  cancelPendingUserInputForSession,
  getPendingUserInput,
  requestUserInput,
  resolvePendingUserInput,
} from "./user-input";

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
    requestUserInput: vi.fn(async () => ({ id: "prompt-1" })),
    clearUserInputPrompt: vi.fn(async () => {}),
  };
}

const conversation: ConversationRef = {
  platform: "telegram",
  id: "-100123",
  kind: "group",
};

afterEach(async () => {
  await cancelAllPendingUserInputs("test cleanup");
});

describe("transport user-input", () => {
  it("returns a deterministic fallback when another question is already pending", async () => {
    const transport = createTransport();

    const first = requestUserInput({
      conversation,
      sessionId: "session-1",
      transport,
      request: { question: "First question?" },
    });

    await Promise.resolve();

    await expect(
      requestUserInput({
        conversation,
        sessionId: "session-1",
        transport,
        request: { question: "Second question?" },
      }),
    ).resolves.toEqual({
      answer: expect.stringContaining("already pending"),
      wasFreeform: true,
    });

    resolvePendingUserInput(conversation, "answer");
    await expect(first).resolves.toEqual({
      answer: "answer",
      wasFreeform: true,
    });
  });

  it("cancels only the pending input for the matching session", async () => {
    const transport = createTransport();

    const pendingResponse = requestUserInput({
      conversation,
      sessionId: "session-1",
      transport,
      request: { question: "Need approval?" },
    });

    await Promise.resolve();

    await expect(
      cancelPendingUserInputForSession(conversation, "session-2", "Wrong session."),
    ).resolves.toBe(false);
    expect(getPendingUserInput(conversation)?.sessionId).toBe("session-1");

    await expect(
      cancelPendingUserInputForSession(conversation, "session-1", "Matching session."),
    ).resolves.toBe(true);
    await expect(pendingResponse).rejects.toBeInstanceOf(PendingUserInputCancelledError);
    expect(getPendingUserInput(conversation)).toBeUndefined();
  });

  it("reserves the pending slot before transport send resolves", async () => {
    let releasePrompt: ((value: { id: string }) => void) | undefined;
    const transport = createTransport();
    vi.mocked(transport.requestUserInput).mockImplementation(
      () =>
        new Promise<{ id: string }>((resolve) => {
          releasePrompt = resolve;
        }),
    );

    const first = requestUserInput({
      conversation,
      sessionId: "session-1",
      transport,
      request: { question: "First question?" },
    });

    expect(getPendingUserInput(conversation)).toMatchObject({
      sessionId: "session-1",
      promptHandle: undefined,
    });

    await expect(
      requestUserInput({
        conversation,
        sessionId: "session-1",
        transport,
        request: { question: "Second question?" },
      }),
    ).resolves.toEqual({
      answer: expect.stringContaining("already pending"),
      wasFreeform: true,
    });

    releasePrompt?.({ id: "55" });
    await Promise.resolve();

    expect(getPendingUserInput(conversation)?.promptHandle).toEqual({ id: "55" });
    resolvePendingUserInput(conversation, "done");
    await expect(first).resolves.toEqual({
      answer: "done",
      wasFreeform: true,
    });
  });

  it("clears the prompt handle when cancelling with notifyUser", async () => {
    const transport = createTransport();

    const pendingResponse = requestUserInput({
      conversation,
      sessionId: "session-1",
      transport,
      request: { question: "Ready?", choices: ["Yes", "No"] },
    });

    await Promise.resolve();

    await cancelPendingUserInput(conversation, "Cancelled.", { notifyUser: true });
    await expect(pendingResponse).rejects.toBeInstanceOf(PendingUserInputCancelledError);

    expect(transport.clearUserInputPrompt).toHaveBeenCalledWith(conversation, { id: "prompt-1" });
    expect(transport.sendText).toHaveBeenCalledWith(conversation, "Cancelled.");
  });
});
