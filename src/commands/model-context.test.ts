import { describe, expect, it, vi } from "vitest";

vi.mock("../agent.js", () => ({
  getModelForChat: vi.fn(() => "gpt-4.1"),
  getReasoningEffortForChat: vi.fn(() => undefined),
}));

vi.mock("../config.js", () => ({
  config: { copilot: { model: "gpt-4.1" } },
}));

describe("formatChatModelContextMarkdown", () => {
  it("shows reasoning effort override when set", async () => {
    const { formatChatModelContextMarkdown } = await import("./model-context.js");

    const result = formatChatModelContextMarkdown({
      defaultModel: "gpt-4.1",
      currentModel: "claude-sonnet-4",
      overrideActive: true,
      reasoningEffort: "high",
    });

    expect(result).toContain("Reasoning effort: `high` (override active)");
  });

  it("shows model default when no reasoning effort override", async () => {
    const { formatChatModelContextMarkdown } = await import("./model-context.js");

    const result = formatChatModelContextMarkdown({
      defaultModel: "gpt-4.1",
      currentModel: "gpt-4.1",
      overrideActive: false,
      reasoningEffort: undefined,
    });

    expect(result).toContain("Reasoning effort: model default");
  });
});
