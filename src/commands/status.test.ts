import { afterEach, describe, expect, it, vi } from "vitest";

const { getSystemStatusMock, formatSystemStatusSummaryMock, getChatModelContextMock } = vi.hoisted(
  () => ({
    getSystemStatusMock: vi.fn<any>(),
    formatSystemStatusSummaryMock: vi.fn<any>(),
    getChatModelContextMock: vi.fn<any>(),
  }),
);

vi.mock("../runtime/state.js", () => ({
  getSystemStatus: getSystemStatusMock,
  formatSystemStatusSummary: formatSystemStatusSummaryMock,
}));

vi.mock("./model-context.js", () => ({
  getChatModelContext: getChatModelContextMock,
}));

afterEach(() => {
  getSystemStatusMock.mockReset();
  formatSystemStatusSummaryMock.mockReset();
  getChatModelContextMock.mockReset();
});

describe("handleStatus", () => {
  it("groups current model directly under default model", async () => {
    getSystemStatusMock.mockResolvedValue({});
    formatSystemStatusSummaryMock.mockReturnValue(
      "Service: neo (active)\nDefault model: gpt-5.4\nLog level: info",
    );
    getChatModelContextMock.mockReturnValue({
      defaultModel: "gpt-5.4",
      channelDefaultModel: null,
      currentModel: "claude-haiku-4.5",
      overrideActive: true,
    });

    const { handleStatus } = await import("./status");

    const reply = vi.fn<any>();
    await handleStatus({ chat: { id: 99 }, reply } as unknown as Parameters<
      typeof handleStatus
    >[0]);

    expect(getChatModelContextMock).toHaveBeenCalledWith(99);
    expect(reply).toHaveBeenCalledWith(
      "Service: neo (active)\nDefault model: gpt-5.4\nCurrent chat model: `claude-haiku-4.5` (override active)\nLog level: info",
      { parse_mode: "Markdown" },
    );
  });

  it("falls back to plain runtime summary when chat context is unavailable", async () => {
    getSystemStatusMock.mockResolvedValue({});
    formatSystemStatusSummaryMock.mockReturnValue("runtime summary");

    const { handleStatus } = await import("./status");

    const reply = vi.fn<any>();
    await handleStatus({ reply } as unknown as Parameters<typeof handleStatus>[0]);

    expect(reply).toHaveBeenCalledWith("runtime summary");
    expect(getChatModelContextMock).not.toHaveBeenCalled();
  });
});
