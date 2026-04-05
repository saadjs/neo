/* eslint-disable vitest/require-mock-type-parameters */
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getModelForChatMock,
  getReasoningEffortForChatMock,
  setReasoningEffortMock,
  clearReasoningEffortMock,
  getModelReasoningInfoMock,
} = vi.hoisted(() => ({
  getModelForChatMock: vi.fn(),
  getReasoningEffortForChatMock: vi.fn(),
  setReasoningEffortMock: vi.fn(),
  clearReasoningEffortMock: vi.fn(),
  getModelReasoningInfoMock: vi.fn(),
}));

vi.mock("../agent.js", () => ({
  getModelForChat: getModelForChatMock,
  getReasoningEffortForChat: getReasoningEffortForChatMock,
  setReasoningEffort: setReasoningEffortMock,
  clearReasoningEffort: clearReasoningEffortMock,
}));

vi.mock("./model-catalog.js", () => ({
  getModelReasoningInfo: getModelReasoningInfoMock,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("handleReasoning", () => {
  it("shows unsupported message when model does not support reasoning effort", async () => {
    getModelForChatMock.mockReturnValue("gpt-4.1");
    getModelReasoningInfoMock.mockResolvedValue({
      supported: false,
      levels: [],
      defaultLevel: undefined,
    });

    const { handleReasoning } = await import("./reasoning");
    const reply = vi.fn();

    await handleReasoning({
      chat: { id: 42 },
      message: { text: "/reasoning" },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith(
      "The current model (`gpt-4.1`) does not support reasoning effort configuration.",
      { parse_mode: "Markdown" },
    );
  });

  it("shows picker when model supports reasoning effort", async () => {
    getModelForChatMock.mockReturnValue("claude-sonnet-4");
    getReasoningEffortForChatMock.mockReturnValue("high");
    getModelReasoningInfoMock.mockResolvedValue({
      supported: true,
      levels: ["low", "medium", "high", "xhigh"],
      defaultLevel: "medium",
    });

    const { handleReasoning } = await import("./reasoning");
    const reply = vi.fn();

    await handleReasoning({
      chat: { id: 42 },
      message: { text: "/reasoning" },
      reply,
    } as never);

    const [text, options] = reply.mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ text: string }>> } },
    ];
    expect(text).toContain("claude-sonnet-4");
    expect(text).toContain("Current: high");
    expect(
      options.reply_markup.inline_keyboard
        .flat()
        .some((b: { text: string }) => b.text === "high ✓"),
    ).toBe(true);
    expect(
      options.reply_markup.inline_keyboard
        .flat()
        .some((b: { text: string }) => b.text === "Reset to default"),
    ).toBe(true);
  });

  it("sets reasoning effort directly with /reasoning <level>", async () => {
    getModelForChatMock.mockReturnValue("claude-sonnet-4");
    getModelReasoningInfoMock.mockResolvedValue({
      supported: true,
      levels: ["low", "medium", "high", "xhigh"],
      defaultLevel: "medium",
    });

    const { handleReasoning } = await import("./reasoning");
    const reply = vi.fn();

    await handleReasoning({
      chat: { id: 42 },
      message: { text: "/reasoning high" },
      reply,
    } as never);

    expect(setReasoningEffortMock).toHaveBeenCalledWith(42, "high");
    expect(reply).toHaveBeenCalledWith(
      "Reasoning effort set to `high`. Session will refresh on next message.",
      { parse_mode: "Markdown" },
    );
  });

  it("rejects invalid reasoning effort level", async () => {
    getModelForChatMock.mockReturnValue("claude-sonnet-4");
    getModelReasoningInfoMock.mockResolvedValue({
      supported: true,
      levels: ["low", "medium", "high"],
      defaultLevel: "medium",
    });

    const { handleReasoning } = await import("./reasoning");
    const reply = vi.fn();

    await handleReasoning({
      chat: { id: 42 },
      message: { text: "/reasoning ultra" },
      reply,
    } as never);

    expect(setReasoningEffortMock).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      "Invalid reasoning effort `ultra`. Valid levels: low, medium, high",
      { parse_mode: "Markdown" },
    );
  });

  it("resets reasoning effort with /reasoning reset", async () => {
    getModelForChatMock.mockReturnValue("claude-sonnet-4");
    getModelReasoningInfoMock.mockResolvedValue({
      supported: true,
      levels: ["low", "medium", "high"],
      defaultLevel: "medium",
    });

    const { handleReasoning } = await import("./reasoning");
    const reply = vi.fn();

    await handleReasoning({
      chat: { id: 42 },
      message: { text: "/reasoning reset" },
      reply,
    } as never);

    expect(clearReasoningEffortMock).toHaveBeenCalledWith(42);
    expect(reply).toHaveBeenCalledWith(
      "Reasoning effort reset to model default. Session will refresh on next message.",
    );
  });
});

describe("handleReasoningCallback", () => {
  it("sets reasoning effort from picker", async () => {
    getModelForChatMock.mockReturnValue("claude-sonnet-4");
    getReasoningEffortForChatMock.mockReturnValue(undefined);
    getModelReasoningInfoMock.mockResolvedValue({
      supported: true,
      levels: ["low", "medium", "high"],
      defaultLevel: "medium",
    });

    const { handleReasoning, handleReasoningCallback } = await import("./reasoning");
    const reply = vi.fn();

    await handleReasoning({
      chat: { id: 42 },
      message: { text: "/reasoning" },
      reply,
    } as never);

    const replyMarkup = (
      reply.mock.calls[0] as [
        string,
        {
          reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
        },
      ]
    )[1].reply_markup;
    const highButton = replyMarkup.inline_keyboard
      .flat()
      .find((b: { text: string }) => b.text === "high");
    expect(highButton).toBeDefined();
    const editMessageText = vi.fn();
    const answerCallbackQuery = vi.fn();

    const handled = await handleReasoningCallback({
      api: { editMessageText },
      answerCallbackQuery,
      callbackQuery: {
        data: highButton!.callback_data,
        message: { message_id: 99 },
      },
      chat: { id: 42 },
    } as never);

    expect(handled).toBe(true);
    expect(setReasoningEffortMock).toHaveBeenCalledWith(42, "high");
    expect(editMessageText).toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: "Set to high" });
  });

  it("resets reasoning effort from picker", async () => {
    getModelForChatMock.mockReturnValue("claude-sonnet-4");
    getReasoningEffortForChatMock.mockReturnValue("high");
    getModelReasoningInfoMock.mockResolvedValue({
      supported: true,
      levels: ["low", "medium", "high"],
      defaultLevel: "medium",
    });

    const { handleReasoning, handleReasoningCallback } = await import("./reasoning");
    const reply = vi.fn();

    await handleReasoning({
      chat: { id: 42 },
      message: { text: "/reasoning" },
      reply,
    } as never);

    const replyMarkup = (
      reply.mock.calls[0] as [
        string,
        {
          reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
        },
      ]
    )[1].reply_markup;
    const resetButton = replyMarkup.inline_keyboard
      .flat()
      .find((b: { text: string }) => b.text === "Reset to default");
    expect(resetButton).toBeDefined();
    const editMessageText = vi.fn();
    const answerCallbackQuery = vi.fn();

    const handled = await handleReasoningCallback({
      api: { editMessageText },
      answerCallbackQuery,
      callbackQuery: {
        data: resetButton!.callback_data,
        message: { message_id: 99 },
      },
      chat: { id: 42 },
    } as never);

    expect(handled).toBe(true);
    expect(clearReasoningEffortMock).toHaveBeenCalledWith(42);
    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: "Reset to default" });
  });

  it("returns false for non-reasoning callback data", async () => {
    const { handleReasoningCallback } = await import("./reasoning");

    const result = await handleReasoningCallback({
      callbackQuery: { data: "model:set:abc:0" },
    } as never);

    expect(result).toBe(false);
  });
});
