import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requestUserInputMock,
  sendTextMock,
  clearUserInputPromptMock,
  infoMock,
  warnMock,
  transport,
} = vi.hoisted(() => {
  const sendTextMock = vi.fn();
  const requestUserInputMock = vi.fn();
  const clearUserInputPromptMock = vi.fn();
  const transport = {
    platform: "telegram" as const,
    capabilities: {
      editableMessages: true,
      typingIndicators: true,
      commands: true,
      interactiveInput: true,
      photoDelivery: true,
      voiceMessages: true,
    },
    sendText: sendTextMock,
    editText: vi.fn(),
    deleteMessage: vi.fn(),
    indicateTyping: vi.fn(),
    sendPhoto: vi.fn(),
    requestUserInput: requestUserInputMock,
    clearUserInputPrompt: clearUserInputPromptMock,
  };

  return {
    requestUserInputMock,
    sendTextMock,
    clearUserInputPromptMock,
    infoMock: vi.fn(),
    warnMock: vi.fn(),
    transport,
  };
});

vi.mock("../transport/notifier.js", () => ({
  getTransport: () => transport,
}));

vi.mock("../logging/index.js", () => ({
  getLogger: () => ({
    info: infoMock,
    warn: warnMock,
  }),
}));

afterEach(async () => {
  const { cancelAllPendingUserInputs } = await import("../transport/user-input");
  await cancelAllPendingUserInputs("test cleanup");
  requestUserInputMock.mockReset();
  sendTextMock.mockReset();
  clearUserInputPromptMock.mockReset();
  infoMock.mockReset();
  warnMock.mockReset();
  vi.resetModules();
});

describe("user input bridge", () => {
  it("sends a question through the transport and resolves with the next answer", async () => {
    requestUserInputMock.mockResolvedValue({ id: "42" });

    const { getPendingUserInput, requestUserInput, resolvePendingUserInput } =
      await import("./user-input");

    const pendingResponse = requestUserInput("-100123", "session-1", {
      question: "Deploy now?",
      choices: ["Yes", "No"],
    });

    await Promise.resolve();

    expect(requestUserInputMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "-100123", platform: "telegram" }),
      expect.objectContaining({
        requestId: expect.any(String),
        question: "Deploy now?",
        choices: ["Yes", "No"],
      }),
    );
    expect(getPendingUserInput("-100123")).toMatchObject({
      conversation: expect.objectContaining({ id: "-100123", platform: "telegram" }),
      sessionId: "session-1",
      promptHandle: { id: "42" },
    });

    expect(resolvePendingUserInput("-100123", "yes")).toEqual({
      answer: "Yes",
      wasFreeform: false,
    });
    await expect(pendingResponse).resolves.toEqual({
      answer: "Yes",
      wasFreeform: false,
    });
    expect(getPendingUserInput("-100123")).toBeUndefined();
  });

  it("cancels a pending question with a typed cancellation error", async () => {
    requestUserInputMock.mockResolvedValue({ id: "9" });
    clearUserInputPromptMock.mockResolvedValue(undefined);
    sendTextMock.mockResolvedValue({ id: "10" });

    const { PendingUserInputCancelledError } = await import("../transport/user-input");
    const { cancelPendingUserInput, requestUserInput } = await import("./user-input");

    const pendingResponse = requestUserInput("-100123", "session-1", {
      question: "Need approval?",
    });

    await Promise.resolve();
    await expect(
      cancelPendingUserInput("-100123", "Pending question cancelled.", { notifyUser: true }),
    ).resolves.toBe(true);
    await expect(pendingResponse).rejects.toBeInstanceOf(PendingUserInputCancelledError);
    expect(clearUserInputPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "-100123" }),
      { id: "9" },
    );
    expect(sendTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "-100123" }),
      "Pending question cancelled.",
    );
  });

  it("keeps choice-only prompts pending on invalid replies", async () => {
    requestUserInputMock.mockResolvedValue({ id: "7" });

    const { getPendingUserInput, requestUserInput, resolvePendingUserInput } =
      await import("./user-input");

    const pendingResponse = requestUserInput("-100123", "session-1", {
      question: "Choose one",
      choices: ["Yes", "No"],
      allowFreeform: false,
    });

    await Promise.resolve();

    expect(resolvePendingUserInput("-100123", "maybe")).toBeUndefined();
    expect(getPendingUserInput("-100123")).toMatchObject({ sessionId: "session-1" });

    expect(resolvePendingUserInput("-100123", "No")).toEqual({
      answer: "No",
      wasFreeform: false,
    });
    await expect(pendingResponse).resolves.toEqual({
      answer: "No",
      wasFreeform: false,
    });
  });

  it("resolves a choice prompt from an inline button callback", async () => {
    requestUserInputMock.mockResolvedValue({ id: "13" });

    const { handleUserInputCallback, requestUserInput } = await import("./user-input");

    const pendingResponse = requestUserInput("-100123", "session-1", {
      question: "Pick one",
      choices: ["Yes", "No"],
      allowFreeform: false,
    });

    await Promise.resolve();

    const prompt = requestUserInputMock.mock.calls[0]?.[1];
    const callbackData = `ask:${prompt.requestId}:0`;

    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    await expect(
      handleUserInputCallback({
        chat: { id: -100123 },
        callbackQuery: {
          data: callbackData,
          message: { message_id: 13 },
        },
        api: {
          editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
        },
        answerCallbackQuery,
      } as never),
    ).resolves.toBe(true);

    await expect(pendingResponse).resolves.toEqual({
      answer: "Yes",
      wasFreeform: false,
    });
    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: "Selected: Yes" });
  });
});
