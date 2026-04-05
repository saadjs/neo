/* eslint-disable vitest/require-mock-type-parameters */
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getModelForChatMock,
  switchModelMock,
  getReasoningEffortForChatMock,
  clearReasoningEffortMock,
  loadModelCatalogMock,
  getModelReasoningInfoMock,
  loadShortlistModelsMock,
  loadCatalogModelsOutsideShortlistMock,
  applyConfigChangeMock,
} = vi.hoisted(() => ({
  getModelForChatMock: vi.fn(),
  switchModelMock: vi.fn(),
  getReasoningEffortForChatMock: vi.fn(),
  clearReasoningEffortMock: vi.fn(),
  loadModelCatalogMock: vi.fn(),
  getModelReasoningInfoMock: vi.fn(),
  loadShortlistModelsMock: vi.fn(),
  loadCatalogModelsOutsideShortlistMock: vi.fn(),
  applyConfigChangeMock: vi.fn().mockResolvedValue({
    applied: true,
    reason: "updated",
    restartTriggered: false,
  }),
}));

vi.mock("../agent.js", () => ({
  getModelForChat: getModelForChatMock,
  switchModel: switchModelMock,
  getReasoningEffortForChat: getReasoningEffortForChatMock,
  clearReasoningEffort: clearReasoningEffortMock,
}));

vi.mock("../runtime/state.js", () => ({
  applyConfigChange: applyConfigChangeMock,
}));

vi.mock("./model-catalog.js", () => ({
  loadModelCatalog: loadModelCatalogMock,
  getModelReasoningInfo: getModelReasoningInfoMock,
  loadShortlistModels: loadShortlistModelsMock,
  loadCatalogModelsOutsideShortlist: loadCatalogModelsOutsideShortlistMock,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

function mockPickerData() {
  loadShortlistModelsMock.mockResolvedValue({
    fetchedAt: "2026-03-13T10:00:00.000Z",
    models: [
      { id: "gpt-5", label: "GPT-5 [copilot]", provider: "copilot", available: true },
      {
        id: "anthropic:claude-sonnet-4.6",
        label: "Claude Sonnet 4.6 [anthropic]",
        provider: "anthropic",
        available: true,
      },
    ],
    stale: false,
  });
  loadCatalogModelsOutsideShortlistMock.mockResolvedValue({
    fetchedAt: "2026-03-13T10:00:00.000Z",
    models: [
      { id: "openai:gpt-4.1-mini", label: "GPT-4.1 Mini [openai]", provider: "openai" },
      { id: "vercel:anthropic/claude-3.7", label: "Claude 3.7 [vercel]", provider: "vercel" },
    ],
    stale: false,
    source: "cache",
  });
}

describe("handleModel", () => {
  it("switches directly and shows reasoning info", async () => {
    loadModelCatalogMock.mockResolvedValue({
      fetchedAt: "2026-03-13T10:00:00.000Z",
      models: [{ id: "gpt-5", label: "GPT-5 [copilot]", provider: "copilot" }],
      stale: false,
      source: "cache",
    });
    getModelReasoningInfoMock.mockResolvedValue({
      supported: true,
      levels: ["low", "medium", "high"],
      defaultLevel: "medium",
    });

    const { handleModel } = await import("./model");
    const reply = vi.fn();

    await handleModel({
      chat: { id: 42 },
      message: { text: "/model gpt-5" },
      reply,
    } as never);

    expect(switchModelMock).toHaveBeenCalledWith(42, "gpt-5");
    const text = reply.mock.calls[0][0] as string;
    expect(text).toContain("Session model switched to `gpt-5` for this chat only.");
    expect(text).toContain("Reasoning effort: medium (default). Use /reasoning to change.");
  });

  it("opens the shortlist picker when no model name is provided", async () => {
    getModelForChatMock.mockReturnValue("gpt-4.1");
    mockPickerData();

    const { handleModel } = await import("./model");
    const reply = vi.fn();

    await handleModel({
      chat: { id: 42 },
      message: { text: "/model" },
      reply,
    } as never);

    const [, options] = reply.mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ text: string }>> } },
    ];
    expect(reply.mock.calls[0][0]).toContain("Choose a model for this chat from your shortlist.");
    expect(reply.mock.calls[0][0]).toContain("Current: gpt-4.1");
    expect(
      options.reply_markup.inline_keyboard
        .flat()
        .some((button: { text: string }) => button.text === "Show All"),
    ).toBe(true);
    expect(
      options.reply_markup.inline_keyboard
        .flat()
        .some((button: { text: string }) => button.text === "Manage Shortlist"),
    ).toBe(true);
  });
});

describe("handleModelCallback", () => {
  it("switches to the selected model from the shortlist picker", async () => {
    getModelForChatMock.mockReturnValue("gpt-4.1");
    getModelReasoningInfoMock.mockResolvedValue({
      supported: true,
      levels: ["low", "medium", "high"],
      defaultLevel: "medium",
    });
    mockPickerData();

    const { handleModel, handleModelCallback } = await import("./model");
    const reply = vi.fn();

    await handleModel({
      chat: { id: 42 },
      message: { text: "/model" },
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
    expect(switchModelMock).toHaveBeenCalledWith(42, "anthropic:claude-sonnet-4.6");
    expect(editMessageText).toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith({
      text: "Switched to anthropic:claude-sonnet-4.6",
    });
  });

  it("opens the full catalog and adds a model as primary", async () => {
    getModelForChatMock.mockReturnValue("gpt-4.1");
    mockPickerData();

    const { handleModel, handleModelCallback } = await import("./model");
    const reply = vi.fn();

    await handleModel({
      chat: { id: 42 },
      message: { text: "/model" },
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
    const showAllCallback = replyMarkup.inline_keyboard
      .flat()
      .find((button: { text: string }) => button.text === "Show All")!.callback_data;
    const editMessageText = vi.fn();
    const answerCallbackQuery = vi.fn();

    await handleModelCallback({
      api: { editMessageText },
      answerCallbackQuery,
      callbackQuery: {
        data: showAllCallback,
        message: { message_id: 99 },
      },
      chat: { id: 42 },
    } as never);

    const catalogMarkup = (editMessageText.mock.calls.at(-1) as [
      number,
      string,
      { parse_mode: string },
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } },
    ])![3].reply_markup;
    const catalogItemCallback = catalogMarkup.inline_keyboard[0][0].callback_data;

    await handleModelCallback({
      api: { editMessageText },
      answerCallbackQuery,
      callbackQuery: {
        data: catalogItemCallback,
        message: { message_id: 99 },
      },
      chat: { id: 42 },
    } as never);

    const detailMarkup = (editMessageText.mock.calls.at(-1) as [
      number,
      string,
      { parse_mode: string },
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } },
    ])![3].reply_markup;
    const addPrimaryCallback = detailMarkup.inline_keyboard[1][0].callback_data;

    await handleModelCallback({
      api: { editMessageText },
      answerCallbackQuery,
      callbackQuery: {
        data: addPrimaryCallback,
        message: { message_id: 99 },
      },
      chat: { id: 42 },
    } as never);

    expect(applyConfigChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "MODEL_SHORTLIST",
        value: JSON.stringify(["openai:gpt-4.1-mini", "gpt-5", "anthropic:claude-sonnet-4.6"]),
      }),
    );
  });
});
