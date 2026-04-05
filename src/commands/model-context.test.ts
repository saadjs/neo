import { afterEach, describe, expect, it, vi } from "vitest";

const { getModelForChatMock, getReasoningEffortForChatMock, getChannelConfigMock } = vi.hoisted(
  () => ({
    getModelForChatMock: vi.fn<any>((_chatId: number): string => "gpt-4.1"),
    getReasoningEffortForChatMock: vi.fn<any>((_chatId: number): string | undefined => undefined),
    getChannelConfigMock: vi.fn<any>(
      (_chatId: number): Record<string, string | number | null> | null => null,
    ),
  }),
);

vi.mock("../agent.js", () => ({
  getModelForChat: getModelForChatMock,
  getReasoningEffortForChat: getReasoningEffortForChatMock,
}));

vi.mock("../config.js", () => ({
  config: {
    copilot: { model: "gpt-4.1" },
    providers: {
      anthropicApiKey: undefined,
      openaiApiKey: undefined,
      vercelAiGatewayApiKey: undefined,
      custom: {
        name: undefined,
        type: undefined,
        baseUrl: undefined,
        apiKey: undefined,
        bearerToken: undefined,
      },
    },
  },
}));

vi.mock("../memory/db.js", () => ({
  getChannelConfig: getChannelConfigMock,
}));

afterEach(() => {
  vi.resetModules();
});

describe("formatChatModelContextMarkdown", () => {
  it("shows reasoning effort override when set", async () => {
    const { formatChatModelContextMarkdown } = await import("./model-context");

    const result = formatChatModelContextMarkdown({
      defaultModel: "gpt-4.1",
      channelDefaultModel: null,
      currentModel: "claude-sonnet-4",
      overrideActive: true,
      reasoningEffort: "high",
      channelDefaultReasoningEffort: null,
      provider: "copilot",
      configuredProviders: ["copilot"],
    });

    expect(result).toContain("Reasoning effort: `high` (override active)");
  });

  it("shows model default when no reasoning effort override", async () => {
    const { formatChatModelContextMarkdown } = await import("./model-context");

    const result = formatChatModelContextMarkdown({
      defaultModel: "gpt-4.1",
      channelDefaultModel: null,
      currentModel: "gpt-4.1",
      overrideActive: false,
      reasoningEffort: undefined,
      channelDefaultReasoningEffort: null,
      provider: "copilot",
      configuredProviders: ["copilot"],
    });

    expect(result).toContain("Reasoning effort: model default");
  });

  it("shows channel default model line when set", async () => {
    const { formatChatModelContextMarkdown } = await import("./model-context");

    const result = formatChatModelContextMarkdown({
      defaultModel: "gpt-4.1",
      channelDefaultModel: "gpt-5.4",
      currentModel: "gpt-5.4",
      overrideActive: false,
      reasoningEffort: undefined,
      channelDefaultReasoningEffort: null,
      provider: "copilot",
      configuredProviders: ["copilot"],
    });

    expect(result).toContain("Channel default: `gpt-5.4`");
    expect(result).toContain("(using channel default)");
  });

  it("shows per-chat override over channel default", async () => {
    const { formatChatModelContextMarkdown } = await import("./model-context");

    const result = formatChatModelContextMarkdown({
      defaultModel: "gpt-4.1",
      channelDefaultModel: "gpt-5.4",
      currentModel: "claude-sonnet-4",
      overrideActive: true,
      reasoningEffort: undefined,
      channelDefaultReasoningEffort: null,
      provider: "copilot",
      configuredProviders: ["copilot"],
    });

    expect(result).toContain("Channel default: `gpt-5.4`");
    expect(result).toContain("Current chat model: `claude-sonnet-4` (override active)");
  });

  it("shows channel default reasoning effort", async () => {
    const { formatChatModelContextMarkdown } = await import("./model-context");

    const result = formatChatModelContextMarkdown({
      defaultModel: "gpt-4.1",
      channelDefaultModel: null,
      currentModel: "gpt-4.1",
      overrideActive: false,
      reasoningEffort: "medium",
      channelDefaultReasoningEffort: "medium",
      provider: "copilot",
      configuredProviders: ["copilot"],
    });

    expect(result).toContain("Reasoning effort: `medium` (channel default)");
  });

  it("shows provider info and available providers", async () => {
    const { formatChatModelContextMarkdown } = await import("./model-context");

    const result = formatChatModelContextMarkdown({
      defaultModel: "gpt-4.1",
      channelDefaultModel: null,
      currentModel: "anthropic:claude-opus-4-6",
      overrideActive: true,
      reasoningEffort: undefined,
      channelDefaultReasoningEffort: null,
      provider: "anthropic",
      configuredProviders: ["copilot", "anthropic", "openai"],
    });

    expect(result).toContain("Provider: anthropic");
    expect(result).toContain("Available providers: copilot, anthropic, openai");
  });

  it("hides available providers when only copilot", async () => {
    const { formatChatModelContextMarkdown } = await import("./model-context");

    const result = formatChatModelContextMarkdown({
      defaultModel: "gpt-4.1",
      channelDefaultModel: null,
      currentModel: "gpt-4.1",
      overrideActive: false,
      reasoningEffort: undefined,
      channelDefaultReasoningEffort: null,
      provider: "copilot",
      configuredProviders: ["copilot"],
    });

    expect(result).toContain("Provider: copilot");
    expect(result).not.toContain("Available providers:");
  });
});

describe("getChatModelContext", () => {
  it("includes channel config in context", async () => {
    getModelForChatMock.mockReturnValue("gpt-5.4");
    getChannelConfigMock.mockReturnValue({
      defaultModel: "gpt-5.4",
      defaultReasoningEffort: "high",
    });
    getReasoningEffortForChatMock.mockReturnValue("high");

    const { getChatModelContext } = await import("./model-context");
    const result = getChatModelContext(-100123);

    expect(result.channelDefaultModel).toBe("gpt-5.4");
    expect(result.channelDefaultReasoningEffort).toBe("high");
    expect(result.overrideActive).toBe(false);
    expect(result.provider).toBe("copilot");
    expect(result.configuredProviders).toContain("copilot");
  });
});
