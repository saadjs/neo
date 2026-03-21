import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  upsertChannelConfigMock,
  getChannelConfigMock,
  refreshSessionContextMock,
  getPerChatModelOverrideMock,
  getModelForChatMock,
  getModelReasoningInfoMock,
  loadModelCatalogMock,
} = vi.hoisted(() => ({
  upsertChannelConfigMock: vi.fn(),
  getChannelConfigMock: vi.fn(),
  refreshSessionContextMock: vi.fn(),
  getPerChatModelOverrideMock: vi.fn(),
  getModelForChatMock: vi.fn(),
  getModelReasoningInfoMock: vi.fn(),
  loadModelCatalogMock: vi.fn(),
}));

vi.mock("../config.js", () => ({
  config: {
    telegram: {
      ownerId: 1,
    },
    copilot: {
      model: "gpt-4.1",
    },
  },
}));

vi.mock("../memory/db.js", () => ({
  getChannelConfig: getChannelConfigMock,
  upsertChannelConfig: upsertChannelConfigMock,
}));

vi.mock("../agent.js", () => ({
  refreshSessionContext: refreshSessionContextMock,
  getPerChatModelOverride: getPerChatModelOverrideMock,
  getModelForChat: getModelForChatMock,
}));

vi.mock("./model-catalog.js", () => ({
  getModelReasoningInfo: getModelReasoningInfoMock,
  loadModelCatalog: loadModelCatalogMock,
}));

import { handleChannel, isChannelCallback } from "./channel";

describe("handleChannel", () => {
  beforeEach(() => {
    upsertChannelConfigMock.mockReset();
    getChannelConfigMock.mockReset();
    refreshSessionContextMock.mockReset();
    getPerChatModelOverrideMock.mockReset();
    getModelForChatMock.mockReset();
    getModelReasoningInfoMock.mockReset();
    loadModelCatalogMock.mockReset();
    getModelForChatMock.mockReturnValue("gpt-4.1");
    getModelReasoningInfoMock.mockResolvedValue({
      supported: true,
      levels: ["low", "medium", "high", "xhigh"],
    });
  });

  it("parses /channel commands that include a bot mention", async () => {
    const reply = vi.fn();

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel@neo_bot topics deployments, incidents" },
      reply,
    } as never);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100123, {
      topics: "deployments, incidents",
    });
    expect(refreshSessionContextMock).toHaveBeenCalledWith(-100123);
    expect(reply).toHaveBeenCalledWith("Topics set to: deployments, incidents");
  });

  it("refreshes the active session after changing the channel label", async () => {
    const reply = vi.fn();

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel label Platform" },
      reply,
    } as never);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100123, { label: "Platform" });
    expect(refreshSessionContextMock).toHaveBeenCalledWith(-100123);
    expect(reply).toHaveBeenCalledWith("Channel label set to: Platform");
  });

  it("shows channel config without Markdown parse mode for user-provided values", async () => {
    const reply = vi.fn();
    getChannelConfigMock.mockReturnValue({
      chatId: -100123,
      label: "dev_ops[*]",
      topics: "deploy_[x], incidents",
      soulOverlay: "overlay with *markdown* chars",
      preferences: "prefs with [brackets]",
      defaultModel: null,
      defaultReasoningEffort: null,
    });

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel" },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith(
      [
        "Channel Config (-100123)",
        "Label: dev_ops[*]",
        "Topics: deploy_[x], incidents",
        "Default Model: (global)",
        "Default Reasoning: (global)",
        "Soul Overlay: overlay with *markdown* chars...",
        "Preferences: prefs with [brackets]...",
      ].join("\n"),
    );
  });

  it("sets channel default model", async () => {
    const reply = vi.fn();
    getPerChatModelOverrideMock.mockReturnValue(undefined);

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel model gpt-4.1" },
      reply,
    } as never);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100123, { defaultModel: "gpt-4.1" });
    expect(refreshSessionContextMock).toHaveBeenCalledWith(-100123);
    expect(reply).toHaveBeenCalledWith("Channel default model set to: gpt-4.1", undefined);
  });

  it("warns about per-chat model override when setting channel model", async () => {
    const reply = vi.fn();
    getPerChatModelOverrideMock.mockReturnValue("gpt-5.4");

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel model gpt-4.1" },
      reply,
    } as never);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100123, { defaultModel: "gpt-4.1" });
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("per-chat override"),
      expect.objectContaining({ parse_mode: "Markdown" }),
    );
  });

  it("clears channel default model", async () => {
    const reply = vi.fn();

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel model clear" },
      reply,
    } as never);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100123, { defaultModel: null });
    expect(refreshSessionContextMock).toHaveBeenCalledWith(-100123);
    expect(reply).toHaveBeenCalledWith("Channel default model cleared.");
  });

  it("sets channel default reasoning effort when model supports it", async () => {
    const reply = vi.fn();
    getModelForChatMock.mockReturnValue("claude-sonnet-4");
    getModelReasoningInfoMock.mockResolvedValue({
      supported: true,
      levels: ["low", "medium", "high"],
    });

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel reasoning high" },
      reply,
    } as never);

    expect(getModelReasoningInfoMock).toHaveBeenCalledWith("claude-sonnet-4");
    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100123, {
      defaultReasoningEffort: "high",
    });
    expect(refreshSessionContextMock).toHaveBeenCalledWith(-100123);
    expect(reply).toHaveBeenCalledWith("Channel default reasoning effort set to: high");
  });

  it("rejects reasoning when channel model does not support it", async () => {
    const reply = vi.fn();
    getModelForChatMock.mockReturnValue("gpt-4.1");
    getModelReasoningInfoMock.mockResolvedValue({ supported: false, levels: [] });

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel reasoning high" },
      reply,
    } as never);

    expect(getModelReasoningInfoMock).toHaveBeenCalledWith("gpt-4.1");
    expect(upsertChannelConfigMock).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("effective chat model"),
      expect.objectContaining({ parse_mode: "Markdown" }),
    );
  });

  it("checks the effective per-chat model when a group override is active", async () => {
    const reply = vi.fn();
    getChannelConfigMock.mockReturnValue({ defaultModel: "gpt-4.1" });
    getModelForChatMock.mockReturnValue("claude-opus-4.6");
    getModelReasoningInfoMock.mockResolvedValue({
      supported: true,
      levels: ["low", "medium", "high"],
    });

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel reasoning high" },
      reply,
    } as never);

    expect(getModelReasoningInfoMock).toHaveBeenCalledWith("claude-opus-4.6");
    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100123, {
      defaultReasoningEffort: "high",
    });
  });

  it("clears channel default reasoning effort", async () => {
    const reply = vi.fn();

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel reasoning clear" },
      reply,
    } as never);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100123, {
      defaultReasoningEffort: null,
    });
    expect(refreshSessionContextMock).toHaveBeenCalledWith(-100123);
    expect(reply).toHaveBeenCalledWith("Channel default reasoning effort cleared.");
  });

  it("rejects invalid reasoning effort", async () => {
    const reply = vi.fn();

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel reasoning turbo" },
      reply,
    } as never);

    expect(upsertChannelConfigMock).not.toHaveBeenCalled();
    expect(refreshSessionContextMock).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Invalid reasoning effort: turbo"));
  });

  it("displays model and reasoning in showChannelConfig", async () => {
    const reply = vi.fn();
    getChannelConfigMock.mockReturnValue({
      chatId: -100123,
      label: "Platform",
      topics: null,
      soulOverlay: null,
      preferences: null,
      defaultModel: "gpt-4.1",
      defaultReasoningEffort: "high",
    });

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel" },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Default Model: gpt-4.1"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Default Reasoning: high"));
  });

  it("sets channel soul overlay", async () => {
    const reply = vi.fn();

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel soul You are a helpful DevOps assistant" },
      reply,
    } as never);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100123, {
      soulOverlay: "You are a helpful DevOps assistant",
    });
    expect(refreshSessionContextMock).toHaveBeenCalledWith(-100123);
    expect(reply).toHaveBeenCalledWith("Channel soul overlay set.");
  });

  it("clears channel soul overlay", async () => {
    const reply = vi.fn();

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel soul clear" },
      reply,
    } as never);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100123, { soulOverlay: null });
    expect(refreshSessionContextMock).toHaveBeenCalledWith(-100123);
    expect(reply).toHaveBeenCalledWith("Channel soul overlay cleared.");
  });

  it("sets channel preferences", async () => {
    const reply = vi.fn();

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel preferences Always respond in bullet points" },
      reply,
    } as never);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100123, {
      preferences: "Always respond in bullet points",
    });
    expect(refreshSessionContextMock).toHaveBeenCalledWith(-100123);
    expect(reply).toHaveBeenCalledWith("Channel preferences set.");
  });

  it("clears channel preferences", async () => {
    const reply = vi.fn();

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel preferences clear" },
      reply,
    } as never);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100123, { preferences: null });
    expect(refreshSessionContextMock).toHaveBeenCalledWith(-100123);
    expect(reply).toHaveBeenCalledWith("Channel preferences cleared.");
  });

  it("shows model picker when /channel model has no args", async () => {
    const reply = vi.fn();
    getChannelConfigMock.mockReturnValue({ defaultModel: "gpt-4.1" });
    loadModelCatalogMock.mockResolvedValue({
      fetchedAt: "2026-03-21T03:00:00Z",
      models: [
        { id: "gpt-4.1", label: "GPT 4.1", provider: "copilot" },
        { id: "claude-sonnet-4", label: "Claude Sonnet 4", provider: "copilot" },
      ],
      source: "cache",
      stale: false,
    });

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel model" },
      reply,
    } as never);

    expect(loadModelCatalogMock).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("Choose a default model for this channel"),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
  });

  it("shows reasoning picker when /channel reasoning has no args", async () => {
    const reply = vi.fn();
    getChannelConfigMock.mockReturnValue({ defaultReasoningEffort: "high" });
    getModelReasoningInfoMock.mockResolvedValue({
      supported: true,
      levels: ["low", "medium", "high", "xhigh"],
    });

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel reasoning" },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("Set default reasoning effort for this channel"),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
  });

  it("shows usage when /channel soul has no args", async () => {
    const reply = vi.fn();

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel soul" },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith("Usage: /channel soul <text> or /channel soul clear");
    expect(upsertChannelConfigMock).not.toHaveBeenCalled();
  });

  it("shows usage when /channel preferences has no args", async () => {
    const reply = vi.fn();

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel preferences" },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith(
      "Usage: /channel preferences <text> or /channel preferences clear",
    );
    expect(upsertChannelConfigMock).not.toHaveBeenCalled();
  });
});

describe("isChannelCallback", () => {
  it("matches ch-model: prefix", () => {
    expect(isChannelCallback("ch-model:set:abc:0")).toBe(true);
  });

  it("matches ch-reasoning: prefix", () => {
    expect(isChannelCallback("ch-reasoning:set:abc:high")).toBe(true);
  });

  it("does not match model: prefix", () => {
    expect(isChannelCallback("model:set:abc:0")).toBe(false);
  });

  it("does not match undefined", () => {
    expect(isChannelCallback(undefined)).toBe(false);
  });
});
