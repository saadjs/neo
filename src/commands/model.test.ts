import { afterEach, describe, expect, it, vi } from "vitest";

const { getModelForChatMock, switchModelMock, loadModelCatalogMock } = vi.hoisted(() => ({
  getModelForChatMock: vi.fn(),
  switchModelMock: vi.fn(),
  loadModelCatalogMock: vi.fn(),
}));

vi.mock("../agent.js", () => ({
  getModelForChat: getModelForChatMock,
  switchModel: switchModelMock,
}));

vi.mock("./model-catalog.js", () => ({
  loadModelCatalog: loadModelCatalogMock,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("handleModel", () => {
  it("switches directly when a model name is provided", async () => {
    const { handleModel } = await import("./model.js");
    const reply = vi.fn();

    await handleModel({
      chat: { id: 42 },
      message: { text: "/model gpt-5" },
      reply,
    } as never);

    expect(switchModelMock).toHaveBeenCalledWith(42, "gpt-5");
    expect(reply).toHaveBeenCalledWith("Session model switched to `gpt-5` for this chat only.", {
      parse_mode: "Markdown",
    });
  });

  it("replies with a paginated picker when no model name is provided", async () => {
    getModelForChatMock.mockReturnValue("gpt-4.1");
    loadModelCatalogMock.mockResolvedValue({
      fetchedAt: "2026-03-13T10:00:00.000Z",
      models: Array.from({ length: 10 }, (_, index) => ({
        id: `model-${index + 1}`,
        label: `Model ${index + 1}`,
      })),
      stale: false,
      source: "cache",
    });

    const { handleModel } = await import("./model.js");
    const reply = vi.fn();

    await handleModel({
      chat: { id: 42 },
      message: { text: "/model" },
      reply,
    } as never);

    const [, options] = reply.mock.calls[0];
    expect(reply.mock.calls[0][0]).toContain("Current: gpt-4.1");
    expect(
      options.reply_markup.inline_keyboard
        .flat()
        .some((button: { text: string }) => button.text === "Next"),
    ).toBe(true);
    expect(
      options.reply_markup.inline_keyboard
        .flat()
        .some((button: { text: string }) => button.text === "Refresh"),
    ).toBe(true);
  });
});

describe("handleModelCallback", () => {
  it("switches to the selected model from the picker", async () => {
    getModelForChatMock.mockReturnValue("gpt-4.1");
    loadModelCatalogMock.mockResolvedValue({
      fetchedAt: "2026-03-13T10:00:00.000Z",
      models: [
        { id: "model-1", label: "Model 1" },
        { id: "model-2", label: "Model 2" },
      ],
      stale: false,
      source: "cache",
    });

    const { handleModel, handleModelCallback } = await import("./model.js");
    const reply = vi.fn();

    await handleModel({
      chat: { id: 42 },
      message: { text: "/model" },
      reply,
    } as never);

    const replyMarkup = reply.mock.calls[0][1].reply_markup;
    const selectCallback = replyMarkup.inline_keyboard[0][1].callback_data;
    const editMessageText = vi.fn();
    const answerCallbackQuery = vi.fn();

    const handled = await handleModelCallback({
      api: { editMessageText },
      answerCallbackQuery,
      callbackQuery: {
        data: selectCallback,
        message: { message_id: 99 },
      },
      chat: { id: 42 },
    } as never);

    expect(handled).toBe(true);
    expect(switchModelMock).toHaveBeenCalledWith(42, "model-2");
    expect(editMessageText).toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: "Switched to model-2" });
  });

  it("refreshes the picker catalog on demand", async () => {
    getModelForChatMock.mockReturnValue("gpt-4.1");
    loadModelCatalogMock
      .mockResolvedValueOnce({
        fetchedAt: "2026-03-13T10:00:00.000Z",
        models: [{ id: "model-1", label: "Model 1" }],
        stale: false,
        source: "cache",
      })
      .mockResolvedValueOnce({
        fetchedAt: "2026-03-13T15:00:00.000Z",
        models: [{ id: "model-2", label: "Model 2" }],
        stale: false,
        source: "network",
      });

    const { handleModel, handleModelCallback } = await import("./model.js");
    const reply = vi.fn();

    await handleModel({
      chat: { id: 42 },
      message: { text: "/model" },
      reply,
    } as never);

    const replyMarkup = reply.mock.calls[0][1].reply_markup;
    const refreshCallback = replyMarkup.inline_keyboard
      .flat()
      .find((button: { text: string }) => button.text === "Refresh")!.callback_data;
    const editMessageText = vi.fn();
    const answerCallbackQuery = vi.fn();

    await handleModelCallback({
      api: { editMessageText },
      answerCallbackQuery,
      callbackQuery: {
        data: refreshCallback,
        message: { message_id: 99 },
      },
      chat: { id: 42 },
    } as never);

    expect(loadModelCatalogMock).toHaveBeenLastCalledWith({ forceRefresh: true });
    expect(editMessageText.mock.calls[0][2]).toContain("Catalog fetched: 2026-03-13T15:00:00.000Z");
    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: "Model list refreshed." });
  });
});
