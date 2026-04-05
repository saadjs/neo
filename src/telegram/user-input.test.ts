import { afterEach, describe, expect, it, vi } from "vitest";

const { sendMessageMock, editMessageReplyMarkupMock, infoMock, warnMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn<any>(),
  editMessageReplyMarkupMock: vi.fn<any>(),
  infoMock: vi.fn<any>(),
  warnMock: vi.fn<any>(),
}));

vi.mock("./runtime.js", () => ({
  getTelegramApi: () => ({
    sendMessage: sendMessageMock,
    editMessageReplyMarkup: editMessageReplyMarkupMock,
  }),
}));

vi.mock("../logging/index.js", () => ({
  getLogger: () => ({
    info: infoMock,
    warn: warnMock,
  }),
}));

afterEach(async () => {
  const { cancelAllPendingUserInputs } = await import("./user-input");
  await cancelAllPendingUserInputs("test cleanup");
  sendMessageMock.mockReset();
  editMessageReplyMarkupMock.mockReset();
  infoMock.mockReset();
  warnMock.mockReset();
  vi.resetModules();
});

describe("user input bridge", () => {
  it("sends a question to Telegram and resolves with the next answer", async () => {
    sendMessageMock.mockResolvedValue({ message_id: 42 });

    const { getPendingUserInput, requestUserInput, resolvePendingUserInput } =
      await import("./user-input");

    const pendingResponse = requestUserInput(-100123, "session-1", {
      question: "Deploy now?",
      choices: ["Yes", "No"],
    });

    await Promise.resolve();

    expect(sendMessageMock).toHaveBeenCalledWith(
      -100123,
      expect.stringContaining("Deploy now?"),
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: [[expect.any(Object)], [expect.any(Object)]],
        }),
      }),
    );
    expect(
      (
        sendMessageMock.mock.calls[0][2] as {
          reply_markup?: { inline_keyboard?: unknown };
        }
      )?.reply_markup?.inline_keyboard,
    ).toEqual([
      [{ text: "Yes", callback_data: expect.stringMatching(/^ask:/) }],
      [{ text: "No", callback_data: expect.stringMatching(/^ask:/) }],
    ]);
    expect(getPendingUserInput(-100123)).toMatchObject({
      chatId: -100123,
      sessionId: "session-1",
      promptMessageId: 42,
    });

    expect(resolvePendingUserInput(-100123, "yes")).toEqual({
      answer: "Yes",
      wasFreeform: false,
    });
    await expect(pendingResponse).resolves.toEqual({
      answer: "Yes",
      wasFreeform: false,
    });
    expect(getPendingUserInput(-100123)).toBeUndefined();
  });

  it("cancels a pending question with a typed cancellation error", async () => {
    sendMessageMock.mockResolvedValue({ message_id: 9 });
    editMessageReplyMarkupMock.mockResolvedValue(undefined);

    const { PendingUserInputCancelledError, cancelPendingUserInput, requestUserInput } =
      await import("./user-input");

    const pendingResponse = requestUserInput(-100123, "session-1", {
      question: "Need approval?",
    });

    await Promise.resolve();
    await expect(
      cancelPendingUserInput(-100123, "Pending question cancelled.", { notifyUser: true }),
    ).resolves.toBe(true);
    await expect(pendingResponse).rejects.toBeInstanceOf(PendingUserInputCancelledError);
    expect(editMessageReplyMarkupMock).toHaveBeenCalledWith(-100123, 9, {
      reply_markup: expect.objectContaining({ inline_keyboard: [[]] }),
    });
    expect(sendMessageMock).toHaveBeenLastCalledWith(-100123, "Pending question cancelled.");
  });

  it("cancels only the pending input for the matching session", async () => {
    sendMessageMock.mockResolvedValue({ message_id: 12 });

    const {
      PendingUserInputCancelledError,
      cancelPendingUserInputForSession,
      getPendingUserInput,
      requestUserInput,
    } = await import("./user-input");

    const pendingResponse = requestUserInput(-100123, "session-1", {
      question: "Need approval?",
    });

    await Promise.resolve();

    await expect(
      cancelPendingUserInputForSession(-100123, "session-2", "Wrong session."),
    ).resolves.toBe(false);
    expect(getPendingUserInput(-100123)?.sessionId).toBe("session-1");

    await expect(
      cancelPendingUserInputForSession(-100123, "session-1", "Matching session."),
    ).resolves.toBe(true);
    await expect(pendingResponse).rejects.toBeInstanceOf(PendingUserInputCancelledError);
    expect(getPendingUserInput(-100123)).toBeUndefined();
  });

  it("returns a deterministic fallback when another question is already pending", async () => {
    sendMessageMock.mockResolvedValue({ message_id: 5 });

    const { requestUserInput, resolvePendingUserInput } = await import("./user-input");

    const first = requestUserInput(-100123, "session-1", {
      question: "First question?",
    });

    await Promise.resolve();

    await expect(
      requestUserInput(-100123, "session-1", {
        question: "Second question?",
      }),
    ).resolves.toEqual({
      answer:
        "User input is already pending in this chat. Do not ask another question until that answer arrives.",
      wasFreeform: true,
    });

    resolvePendingUserInput(-100123, "answer");
    await expect(first).resolves.toEqual({
      answer: "answer",
      wasFreeform: true,
    });
  });

  it("reserves the pending slot before Telegram send resolves", async () => {
    let releaseSend: ((value: { message_id: number }) => void) | undefined;
    sendMessageMock.mockImplementation(
      () =>
        new Promise<{ message_id: number }>((resolve) => {
          releaseSend = resolve;
        }),
    );

    const { getPendingUserInput, requestUserInput, resolvePendingUserInput } =
      await import("./user-input");

    const first = requestUserInput(-100123, "session-1", {
      question: "First question?",
    });

    expect(getPendingUserInput(-100123)).toMatchObject({
      chatId: -100123,
      sessionId: "session-1",
      promptMessageId: undefined,
    });

    await expect(
      requestUserInput(-100123, "session-1", {
        question: "Second question?",
      }),
    ).resolves.toEqual({
      answer:
        "User input is already pending in this chat. Do not ask another question until that answer arrives.",
      wasFreeform: true,
    });

    releaseSend?.({ message_id: 55 });
    await Promise.resolve();

    expect(getPendingUserInput(-100123)?.promptMessageId).toBe(55);
    resolvePendingUserInput(-100123, "done");
    await expect(first).resolves.toEqual({
      answer: "done",
      wasFreeform: true,
    });
  });

  it("keeps choice-only prompts pending on invalid replies", async () => {
    sendMessageMock.mockResolvedValue({ message_id: 7 });

    const { getPendingUserInput, requestUserInput, resolvePendingUserInput } =
      await import("./user-input");

    const pendingResponse = requestUserInput(-100123, "session-1", {
      question: "Choose one",
      choices: ["Yes", "No"],
      allowFreeform: false,
    });

    await Promise.resolve();

    expect(resolvePendingUserInput(-100123, "maybe")).toBeUndefined();
    expect(getPendingUserInput(-100123)).toMatchObject({
      chatId: -100123,
      sessionId: "session-1",
    });

    expect(resolvePendingUserInput(-100123, "No")).toEqual({
      answer: "No",
      wasFreeform: false,
    });
    await expect(pendingResponse).resolves.toEqual({
      answer: "No",
      wasFreeform: false,
    });
  });

  it("resolves a choice prompt from an inline button callback", async () => {
    sendMessageMock.mockResolvedValue({ message_id: 13 });
    editMessageReplyMarkupMock.mockResolvedValue(undefined);

    const { handleUserInputCallback, requestUserInput } = await import("./user-input");

    const pendingResponse = requestUserInput(-100123, "session-1", {
      question: "Pick one",
      choices: ["Yes", "No"],
      allowFreeform: false,
    });

    await Promise.resolve();

    const sendArgs = sendMessageMock.mock.calls[0] as [
      number,
      string,
      { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data: string }>> } },
    ];
    const buttons = sendArgs?.[2]?.reply_markup?.inline_keyboard as Array<
      Array<{ callback_data: string }>
    >;
    const callbackData = buttons[0][0]?.callback_data;
    expect(callbackData).toMatch(/^ask:/);

    const answerCallbackQuery = vi.fn<any>().mockResolvedValue(undefined);
    await expect(
      handleUserInputCallback({
        chat: { id: -100123 },
        callbackQuery: {
          data: callbackData,
          message: { message_id: 13 },
        },
        api: {
          editMessageReplyMarkup: editMessageReplyMarkupMock,
        },
        answerCallbackQuery,
      } as never),
    ).resolves.toBe(true);

    await expect(pendingResponse).resolves.toEqual({
      answer: "Yes",
      wasFreeform: false,
    });
    expect(editMessageReplyMarkupMock).toHaveBeenCalledWith(-100123, 13, {
      reply_markup: expect.objectContaining({ inline_keyboard: [[]] }),
    });
    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: "Selected: Yes" });
  });

  it("resolves a callback even when promptMessageId has not been set yet", async () => {
    let releaseSend: ((value: { message_id: number }) => void) | undefined;
    sendMessageMock.mockImplementation(
      () =>
        new Promise<{ message_id: number }>((resolve) => {
          releaseSend = resolve;
        }),
    );
    editMessageReplyMarkupMock.mockResolvedValue(undefined);

    const { handleUserInputCallback, requestUserInput } = await import("./user-input");

    const pendingResponse = requestUserInput(-100123, "session-1", {
      question: "Pick one",
      choices: ["Alpha", "Beta"],
      allowFreeform: false,
    });

    // sendMessage has NOT resolved yet, so promptMessageId is undefined
    const sendArgs = sendMessageMock.mock.calls[0] as [
      number,
      string,
      { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data: string }>> } },
    ];
    const buttons = sendArgs?.[2]?.reply_markup?.inline_keyboard as Array<
      Array<{ callback_data: string }>
    >;
    const callbackData = buttons[0][0]?.callback_data;

    const answerCallbackQuery = vi.fn<any>().mockResolvedValue(undefined);
    await expect(
      handleUserInputCallback({
        chat: { id: -100123 },
        callbackQuery: {
          data: callbackData,
          message: { message_id: 77 },
        },
        answerCallbackQuery,
      } as never),
    ).resolves.toBe(true);

    await expect(pendingResponse).resolves.toEqual({
      answer: "Alpha",
      wasFreeform: false,
    });
    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: "Selected: Alpha" });

    // Let sendMessage resolve after the fact — should not cause issues
    releaseSend?.({ message_id: 77 });
  });
});
