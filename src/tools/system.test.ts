import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (_name: string, definition: unknown) => definition,
}));

const {
  clearPerChatModelOverrideMock,
  clearReasoningEffortMock,
  getModelForChatMock,
  getPerChatModelOverrideMock,
  getPerChatReasoningEffortOverrideMock,
  getReasoningEffortForChatMock,
  refreshSessionContextMock,
  switchModelMock,
  getChannelConfigMock,
  upsertChannelConfigMock,
  loadModelCatalogMock,
  createAuditTimerMock,
} = vi.hoisted(() => ({
  clearPerChatModelOverrideMock: vi.fn(),
  clearReasoningEffortMock: vi.fn(),
  getModelForChatMock: vi.fn(),
  getPerChatModelOverrideMock: vi.fn(),
  getPerChatReasoningEffortOverrideMock: vi.fn(),
  getReasoningEffortForChatMock: vi.fn(),
  refreshSessionContextMock: vi.fn(),
  switchModelMock: vi.fn(),
  getChannelConfigMock: vi.fn(),
  upsertChannelConfigMock: vi.fn(),
  loadModelCatalogMock: vi.fn(),
  createAuditTimerMock: vi.fn(() => ({
    complete: vi.fn(),
  })),
}));

vi.mock("../agent.js", () => ({
  clearPerChatModelOverride: clearPerChatModelOverrideMock,
  clearReasoningEffort: clearReasoningEffortMock,
  getModelForChat: getModelForChatMock,
  getPerChatModelOverride: getPerChatModelOverrideMock,
  getPerChatReasoningEffortOverride: getPerChatReasoningEffortOverrideMock,
  getReasoningEffortForChat: getReasoningEffortForChatMock,
  refreshSessionContext: refreshSessionContextMock,
  switchModel: switchModelMock,
}));

vi.mock("../commands/model-catalog.js", () => ({
  loadModelCatalog: loadModelCatalogMock,
}));

vi.mock("../memory/db.js", () => ({
  getChannelConfig: getChannelConfigMock,
  upsertChannelConfig: upsertChannelConfigMock,
}));

vi.mock("../logging/audit.js", () => ({
  createAuditTimer: createAuditTimerMock,
}));

vi.mock("../config.js", () => ({
  getManagedConfigDefinition: vi.fn(),
  isManagedConfigKey: vi.fn(() => false),
}));

vi.mock("../runtime/state.js", () => ({
  applyConfigChange: vi.fn(),
  explainSetting: vi.fn(),
  formatSystemStatusSummary: vi.fn(),
  getRecentChanges: vi.fn(),
  getRecentRestarts: vi.fn(),
  getSystemStatus: vi.fn(),
  planConfigChange: vi.fn(),
  restartService: vi.fn(),
}));

import { systemTool } from "./system";

const handler = systemTool.handler as (
  args: Record<string, unknown>,
  invocation: { sessionId: string },
) => Promise<string>;

const invocation = { sessionId: "test-session" };

describe("system tool — set_chat_model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPerChatReasoningEffortOverrideMock.mockReturnValue(undefined);
    loadModelCatalogMock.mockResolvedValue({
      models: [
        {
          id: "claude-opus-4-6",
          label: "Claude Opus 4.6",
          provider: "copilot",
          supportsReasoningEffort: true,
          supportedReasoningEfforts: ["medium", "high"],
          defaultReasoningEffort: "medium",
        },
        {
          id: "gpt-4.1",
          label: "GPT-4.1",
          provider: "copilot",
          supportsReasoningEffort: false,
          supportedReasoningEfforts: [],
        },
        {
          id: "gpt-5.4",
          label: "GPT-5.4",
          provider: "copilot",
          supportsReasoningEffort: true,
          supportedReasoningEfforts: ["low", "medium"],
          defaultReasoningEffort: "medium",
        },
      ],
    });
  });

  it("requires chat_id", async () => {
    const result = await handler({ action: "set_chat_model" }, invocation);
    expect(result).toContain("chat_id is required");
  });

  it("requires model", async () => {
    const result = await handler({ action: "set_chat_model", chat_id: -100 }, invocation);
    expect(result).toContain("model is required");
  });

  it("rejects unknown models before persisting them", async () => {
    const result = await handler(
      { action: "set_chat_model", chat_id: -100, model: "unknown-model" },
      invocation,
    );

    expect(result).toContain("unknown model: unknown-model");
    expect(upsertChannelConfigMock).not.toHaveBeenCalled();
    expect(switchModelMock).not.toHaveBeenCalled();
  });

  it("sets channel default and clears per-chat override by default", async () => {
    getPerChatModelOverrideMock.mockReturnValue("gpt-5.4");

    const result = await handler(
      { action: "set_chat_model", chat_id: -100, model: "claude-opus-4-6" },
      invocation,
    );
    const parsed = JSON.parse(result);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100, {
      defaultModel: "claude-opus-4-6",
    });
    expect(clearPerChatModelOverrideMock).toHaveBeenCalledWith(-100);
    expect(parsed.applied).toBe(true);
    expect(parsed.scope).toBe("channel");
    expect(parsed.channelDefaultModel).toBe("claude-opus-4-6");
    expect(parsed.previousPerChatOverride).toBe("gpt-5.4");
    expect(parsed.perChatOverrideCleared).toBe(true);
    expect(parsed.restartTriggered).toBe(false);
  });

  it("sets channel default without per-chat override present", async () => {
    getPerChatModelOverrideMock.mockReturnValue(undefined);

    const result = await handler(
      { action: "set_chat_model", chat_id: -200, model: "gpt-4.1" },
      invocation,
    );
    const parsed = JSON.parse(result);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-200, { defaultModel: "gpt-4.1" });
    expect(clearPerChatModelOverrideMock).not.toHaveBeenCalled();
    expect(refreshSessionContextMock).toHaveBeenCalledWith(-200);
    expect(parsed.applied).toBe(true);
    expect(parsed.scope).toBe("channel");
    expect(parsed.previousPerChatOverride).toBeUndefined();
  });

  it("clears incompatible channel-default reasoning when setting a channel default", async () => {
    getPerChatModelOverrideMock.mockReturnValue(undefined);
    getPerChatReasoningEffortOverrideMock.mockReturnValue(undefined);
    getReasoningEffortForChatMock.mockReturnValue("high");
    getChannelConfigMock.mockReturnValue({ defaultReasoningEffort: "high" });

    const result = await handler(
      { action: "set_chat_model", chat_id: -200, model: "gpt-4.1" },
      invocation,
    );
    const parsed = JSON.parse(result);

    expect(clearReasoningEffortMock).not.toHaveBeenCalled();
    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-200, { defaultReasoningEffort: null });
    expect(refreshSessionContextMock).toHaveBeenCalledWith(-200);
    expect(parsed.previousReasoningEffort).toBe("high");
    expect(parsed.reasoningEffortCleared).toBe(true);
    expect(parsed.reasoningEffortClearedFrom).toBe("channel");
  });

  it("sets per-chat override when scope is chat", async () => {
    getPerChatModelOverrideMock.mockReturnValue("gpt-4.1");

    const result = await handler(
      { action: "set_chat_model", chat_id: 123, model: "claude-opus-4-6", scope: "chat" },
      invocation,
    );
    const parsed = JSON.parse(result);

    expect(switchModelMock).toHaveBeenCalledWith(123, "claude-opus-4-6");
    expect(upsertChannelConfigMock).not.toHaveBeenCalled();
    expect(parsed.applied).toBe(true);
    expect(parsed.scope).toBe("chat");
    expect(parsed.perChatModel).toBe("claude-opus-4-6");
    expect(parsed.previousPerChatModel).toBe("gpt-4.1");
  });

  it("sets per-chat override when no previous override exists", async () => {
    getPerChatModelOverrideMock.mockReturnValue(undefined);

    const result = await handler(
      { action: "set_chat_model", chat_id: 456, model: "gpt-5.4", scope: "chat" },
      invocation,
    );
    const parsed = JSON.parse(result);

    expect(switchModelMock).toHaveBeenCalledWith(456, "gpt-5.4");
    expect(parsed.previousPerChatModel).toBeNull();
  });

  it("clears incompatible per-chat reasoning overrides when setting a per-chat model", async () => {
    getPerChatModelOverrideMock.mockReturnValue(undefined);
    getPerChatReasoningEffortOverrideMock.mockReturnValue("high");
    getReasoningEffortForChatMock.mockReturnValue("high");

    const result = await handler(
      { action: "set_chat_model", chat_id: 456, model: "gpt-5.4", scope: "chat" },
      invocation,
    );
    const parsed = JSON.parse(result);

    expect(switchModelMock).toHaveBeenCalledWith(456, "gpt-5.4");
    expect(clearReasoningEffortMock).toHaveBeenCalledWith(456);
    expect(parsed.previousReasoningEffort).toBe("high");
    expect(parsed.reasoningEffortCleared).toBe(true);
    expect(parsed.reasoningEffortClearedFrom).toBe("chat");
  });

  it("preserves channel reasoning defaults when setting a per-chat model", async () => {
    getPerChatModelOverrideMock.mockReturnValue(undefined);
    getPerChatReasoningEffortOverrideMock.mockReturnValue(undefined);
    getReasoningEffortForChatMock.mockReturnValue("high");
    getChannelConfigMock.mockReturnValue({ defaultReasoningEffort: "high" });

    const result = await handler(
      { action: "set_chat_model", chat_id: 456, model: "gpt-5.4", scope: "chat" },
      invocation,
    );
    const parsed = JSON.parse(result);

    expect(switchModelMock).toHaveBeenCalledWith(456, "gpt-5.4");
    expect(clearReasoningEffortMock).not.toHaveBeenCalled();
    expect(upsertChannelConfigMock).not.toHaveBeenCalledWith(456, {
      defaultReasoningEffort: null,
    });
    expect(refreshSessionContextMock).not.toHaveBeenCalledWith(456);
    expect(parsed.reasoningEffortCleared).toBeUndefined();
  });

  it("keeps compatible reasoning overrides when the new model supports them", async () => {
    getPerChatModelOverrideMock.mockReturnValue(undefined);
    getReasoningEffortForChatMock.mockReturnValue("medium");

    const result = await handler(
      { action: "set_chat_model", chat_id: 456, model: "gpt-5.4", scope: "chat" },
      invocation,
    );
    const parsed = JSON.parse(result);

    expect(clearReasoningEffortMock).not.toHaveBeenCalled();
    expect(parsed.reasoningEffortCleared).toBeUndefined();
  });
});

describe("system tool — clear_chat_model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getReasoningEffortForChatMock.mockReturnValue(undefined);
    getPerChatReasoningEffortOverrideMock.mockReturnValue(undefined);
    getModelForChatMock.mockReturnValue("claude-opus-4-6");
    loadModelCatalogMock.mockResolvedValue({
      models: [
        {
          id: "claude-opus-4-6",
          supportsReasoningEffort: true,
          supportedReasoningEfforts: ["low", "medium", "high"],
        },
        {
          id: "gpt-4.1",
          supportsReasoningEffort: false,
          supportedReasoningEfforts: [],
        },
        {
          id: "gpt-5.4",
          supportsReasoningEffort: false,
          supportedReasoningEfforts: [],
        },
      ],
    });
  });

  it("requires chat_id", async () => {
    const result = await handler({ action: "clear_chat_model" }, invocation);
    expect(result).toContain("chat_id is required");
  });

  it("clears per-chat override first when both exist and no scope given", async () => {
    getChannelConfigMock.mockReturnValue({ defaultModel: "claude-opus-4-6" });
    getPerChatModelOverrideMock.mockReturnValue("gpt-5.4");

    const result = await handler({ action: "clear_chat_model", chat_id: -100 }, invocation);
    const parsed = JSON.parse(result);

    // Should only clear per-chat override, preserving channel default
    expect(clearPerChatModelOverrideMock).toHaveBeenCalledWith(-100);
    expect(upsertChannelConfigMock).not.toHaveBeenCalled();
    expect(parsed.cleared).toEqual(["per_chat_override"]);
  });

  it("clears channel default when no per-chat override exists and no scope given", async () => {
    getChannelConfigMock.mockReturnValue({ defaultModel: "gpt-4.1" });
    getPerChatModelOverrideMock.mockReturnValue(undefined);

    const result = await handler({ action: "clear_chat_model", chat_id: -200 }, invocation);
    const parsed = JSON.parse(result);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-200, { defaultModel: null });
    expect(clearPerChatModelOverrideMock).not.toHaveBeenCalled();
    expect(refreshSessionContextMock).toHaveBeenCalledWith(-200);
    expect(parsed.cleared).toEqual(["channel_default"]);
  });

  it("clears only channel default when scope is channel", async () => {
    getChannelConfigMock.mockReturnValue({ defaultModel: "claude-opus-4-6" });
    getPerChatModelOverrideMock.mockReturnValue("gpt-5.4");

    const result = await handler(
      { action: "clear_chat_model", chat_id: -100, scope: "channel" },
      invocation,
    );
    const parsed = JSON.parse(result);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-100, { defaultModel: null });
    expect(clearPerChatModelOverrideMock).not.toHaveBeenCalled();
    expect(parsed.cleared).toEqual(["channel_default"]);
  });

  it("clears only per-chat override when scope is chat", async () => {
    getChannelConfigMock.mockReturnValue({ defaultModel: "claude-opus-4-6" });
    getPerChatModelOverrideMock.mockReturnValue("gpt-5.4");

    const result = await handler(
      { action: "clear_chat_model", chat_id: -100, scope: "chat" },
      invocation,
    );
    const parsed = JSON.parse(result);

    expect(clearPerChatModelOverrideMock).toHaveBeenCalledWith(-100);
    expect(upsertChannelConfigMock).not.toHaveBeenCalled();
    expect(parsed.cleared).toEqual(["per_chat_override"]);
  });

  it("handles case where nothing to clear", async () => {
    getChannelConfigMock.mockReturnValue(null);
    getPerChatModelOverrideMock.mockReturnValue(undefined);

    const result = await handler({ action: "clear_chat_model", chat_id: -400 }, invocation);
    const parsed = JSON.parse(result);

    expect(parsed.cleared).toEqual([]);
    expect(refreshSessionContextMock).toHaveBeenCalledWith(-400);
  });

  it("clears incompatible per-chat reasoning when reverting to a fallback model that lacks support", async () => {
    // per-chat override was "claude-opus-4-6" with per-chat reasoning "high"
    // Fallback after clearing: "gpt-4.1" (no reasoning support)
    getChannelConfigMock.mockReturnValue({ defaultModel: "gpt-4.1" });
    getPerChatModelOverrideMock.mockReturnValue("claude-opus-4-6");
    getReasoningEffortForChatMock.mockReturnValue("high");
    getPerChatReasoningEffortOverrideMock.mockReturnValue("high");
    getModelForChatMock.mockReturnValue("gpt-4.1"); // effective after per-chat model is cleared

    const result = await handler(
      { action: "clear_chat_model", chat_id: -500, scope: "chat" },
      invocation,
    );
    const parsed = JSON.parse(result);

    expect(clearPerChatModelOverrideMock).toHaveBeenCalledWith(-500);
    expect(clearReasoningEffortMock).toHaveBeenCalledWith(-500);
    expect(parsed.cleared).toEqual(["per_chat_override"]);
    expect(parsed.reasoningEffortCleared).toBe(true);
    expect(parsed.reasoningEffortClearedFrom).toBe("chat");
  });

  it("clears incompatible channel reasoning when clearing channel default that reverts to a model lacking support", async () => {
    // channel default was "claude-opus-4-6" with channel reasoning "high"
    // Fallback after clearing: global default "gpt-4.1" (no reasoning support)
    getChannelConfigMock.mockReturnValue({
      defaultModel: "claude-opus-4-6",
      defaultReasoningEffort: "high",
    });
    getPerChatModelOverrideMock.mockReturnValue(undefined);
    getReasoningEffortForChatMock.mockReturnValue("high");
    getPerChatReasoningEffortOverrideMock.mockReturnValue(undefined);
    getModelForChatMock.mockReturnValue("gpt-4.1"); // effective after channel default is cleared

    const result = await handler(
      { action: "clear_chat_model", chat_id: -600, scope: "channel" },
      invocation,
    );
    const parsed = JSON.parse(result);

    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-600, { defaultModel: null });
    expect(upsertChannelConfigMock).toHaveBeenCalledWith(-600, { defaultReasoningEffort: null });
    expect(parsed.cleared).toEqual(["channel_default"]);
    expect(parsed.reasoningEffortCleared).toBe(true);
    expect(parsed.reasoningEffortClearedFrom).toBe("channel");
  });

  it("preserves reasoning when fallback model supports the active effort level", async () => {
    // per-chat override was "gpt-4.1", fallback is "claude-opus-4-6" which supports "high"
    getChannelConfigMock.mockReturnValue({ defaultModel: "claude-opus-4-6" });
    getPerChatModelOverrideMock.mockReturnValue("gpt-4.1");
    getReasoningEffortForChatMock.mockReturnValue("high");
    getPerChatReasoningEffortOverrideMock.mockReturnValue(undefined);
    getModelForChatMock.mockReturnValue("claude-opus-4-6");

    const result = await handler(
      { action: "clear_chat_model", chat_id: -700, scope: "chat" },
      invocation,
    );
    const parsed = JSON.parse(result);

    expect(clearPerChatModelOverrideMock).toHaveBeenCalledWith(-700);
    expect(clearReasoningEffortMock).not.toHaveBeenCalled();
    expect(parsed.reasoningEffortCleared).toBeUndefined();
  });
});
