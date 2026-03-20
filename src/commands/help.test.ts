import { afterEach, describe, expect, it, vi } from "vitest";

const { buildHelpTextMock, getChatModelContextMock } = vi.hoisted(() => ({
  buildHelpTextMock: vi.fn(),
  getChatModelContextMock: vi.fn(),
}));

vi.mock("./definitions.js", () => ({
  buildHelpText: buildHelpTextMock,
}));

vi.mock("./model-context.js", () => ({
  getChatModelContext: getChatModelContextMock,
}));

afterEach(() => {
  buildHelpTextMock.mockReset();
  getChatModelContextMock.mockReset();
});

describe("handleHelp", () => {
  it("includes model context when chat is available", async () => {
    buildHelpTextMock.mockReturnValue("HELP");
    getChatModelContextMock.mockReturnValue({
      defaultModel: "gpt-5.4",
      channelDefaultModel: null,
      currentModel: "claude-haiku-4.5",
      overrideActive: true,
    });

    const { handleHelp } = await import("./help");

    const reply = vi.fn();
    await handleHelp({ chat: { id: 7 }, reply } as unknown as Parameters<typeof handleHelp>[0]);

    expect(getChatModelContextMock).toHaveBeenCalledWith(7);
    expect(reply).toHaveBeenCalledWith(
      "Hey — using `claude-haiku-4.5` (per-chat override, default is `gpt-5.4`).\n\nHELP",
      { parse_mode: "Markdown" },
    );
  });

  it("keeps plain help output for missing chat context", async () => {
    buildHelpTextMock.mockReturnValue("HELP");

    const { handleHelp } = await import("./help");

    const reply = vi.fn();
    await handleHelp({ reply } as unknown as Parameters<typeof handleHelp>[0]);

    expect(reply).toHaveBeenCalledWith("HELP", { parse_mode: "Markdown" });
    expect(getChatModelContextMock).not.toHaveBeenCalled();
  });
});
