import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  upsertChannelConfigMock,
  getChannelConfigMock,
  refreshSessionContextMock,
  getPerChatModelOverrideMock,
  getModelReasoningInfoMock,
} = vi.hoisted(() => ({
  upsertChannelConfigMock: vi.fn(),
  getChannelConfigMock: vi.fn(),
  refreshSessionContextMock: vi.fn(),
  getPerChatModelOverrideMock: vi.fn(),
  getModelReasoningInfoMock: vi.fn(),
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
}));

vi.mock("./model-catalog.js", () => ({
  getModelReasoningInfo: getModelReasoningInfoMock,
}));

import { handleChannel } from "./channel";

describe("handleChannel", () => {
  beforeEach(() => {
    upsertChannelConfigMock.mockReset();
    getChannelConfigMock.mockReset();
    refreshSessionContextMock.mockReset();
    getPerChatModelOverrideMock.mockReset();
    getModelReasoningInfoMock.mockReset();
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
    getChannelConfigMock.mockReturnValue({ defaultModel: "claude-sonnet-4" });
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
    getChannelConfigMock.mockReturnValue({ defaultModel: "gpt-4.1" });
    getModelReasoningInfoMock.mockResolvedValue({ supported: false, levels: [] });

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel reasoning high" },
      reply,
    } as never);

    expect(getModelReasoningInfoMock).toHaveBeenCalledWith("gpt-4.1");
    expect(upsertChannelConfigMock).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("does not support reasoning"),
      expect.objectContaining({ parse_mode: "Markdown" }),
    );
  });

  it("checks global default model when no channel model is set", async () => {
    const reply = vi.fn();
    getChannelConfigMock.mockReturnValue(null);
    getModelReasoningInfoMock.mockResolvedValue({ supported: false, levels: [] });

    await handleChannel({
      chat: { id: -100123 },
      message: { text: "/channel reasoning high" },
      reply,
    } as never);

    expect(getModelReasoningInfoMock).toHaveBeenCalledWith("gpt-4.1");
    expect(upsertChannelConfigMock).not.toHaveBeenCalled();
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
});
