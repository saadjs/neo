import { afterEach, describe, expect, it, vi } from "vitest";

const { getChatModelContextMock, formatChatModelContextMarkdownMock } = vi.hoisted(() => ({
  getChatModelContextMock: vi.fn(),
  formatChatModelContextMarkdownMock: vi.fn(),
}));

vi.mock("./model-context.js", () => ({
  getChatModelContext: getChatModelContextMock,
  formatChatModelContextMarkdown: formatChatModelContextMarkdownMock,
}));

afterEach(() => {
  getChatModelContextMock.mockReset();
  formatChatModelContextMarkdownMock.mockReset();
});

describe("handleWhichModel", () => {
  it("replies with default + current model details for the current chat", async () => {
    getChatModelContextMock.mockReturnValue({
      defaultModel: "gpt-5.4",
      currentModel: "claude-haiku-4.5",
      overrideActive: true,
    });
    formatChatModelContextMarkdownMock.mockReturnValue(
      "Default model: `gpt-5.4`\nCurrent chat model: `claude-haiku-4.5` (override active)",
    );

    const { handleWhichModel } = await import("./whichmodel");

    const reply = vi.fn();
    await handleWhichModel({ chat: { id: 42 }, reply } as unknown as Parameters<
      typeof handleWhichModel
    >[0]);

    expect(getChatModelContextMock).toHaveBeenCalledWith("42");
    expect(reply).toHaveBeenCalledWith(
      "Default model: `gpt-5.4`\nCurrent chat model: `claude-haiku-4.5` (override active)",
      { parse_mode: "Markdown" },
    );
  });

  it("handles missing chat context gracefully", async () => {
    const { handleWhichModel } = await import("./whichmodel");

    const reply = vi.fn();
    await handleWhichModel({ reply } as unknown as Parameters<typeof handleWhichModel>[0]);

    expect(reply).toHaveBeenCalledWith("Unable to determine chat model without chat context.");
    expect(getChatModelContextMock).not.toHaveBeenCalled();
  });
});
