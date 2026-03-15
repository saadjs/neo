import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "@github/copilot-sdk";

const { dataDir, listModelsMock, getClientMock } = vi.hoisted(() => ({
  dataDir: "/tmp/neo-model-catalog-test",
  listModelsMock: vi.fn(),
  getClientMock: vi.fn(),
}));

vi.mock("../config.js", () => ({
  config: {
    paths: { data: dataDir },
  },
}));

vi.mock("../agent.js", () => ({
  getClient: getClientMock,
}));

function createModel(
  id: string,
  name: string,
  policyState: "enabled" | "disabled" | "unconfigured" = "enabled",
  reasoning?: {
    supported?: boolean;
    levels?: ("low" | "medium" | "high" | "xhigh")[];
    defaultLevel?: "low" | "medium" | "high" | "xhigh";
  },
): ModelInfo {
  const supportsReasoning = reasoning?.supported ?? true;
  return {
    id,
    name,
    capabilities: {
      supports: {
        vision: false,
        reasoningEffort: supportsReasoning,
      },
      limits: {
        max_context_window_tokens: 200000,
      },
    },
    policy: {
      state: policyState,
      terms: "",
    },
    ...(supportsReasoning && {
      supportedReasoningEfforts: reasoning?.levels ?? ["low", "medium", "high"],
      defaultReasoningEffort: reasoning?.defaultLevel ?? "medium",
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  rmSync(dataDir, { recursive: true, force: true });
  listModelsMock.mockReset();
  getClientMock.mockReset();
});

describe("loadModelCatalog", () => {
  it("loads models from the Copilot SDK and persists cache", async () => {
    listModelsMock.mockResolvedValue([
      createModel("gpt-4.1", "GPT-4.1"),
      createModel("claude-opus-4.6", "Claude Opus 4.6"),
      createModel("gpt-5.4", "GPT-5.4"),
      createModel("old-model", "Old model", "disabled"),
    ]);
    getClientMock.mockReturnValue({ listModels: listModelsMock });

    const { loadModelCatalog } = await import("./model-catalog.js");
    const result = await loadModelCatalog();

    expect(result.source).toBe("network");
    expect(result.stale).toBe(false);
    expect(result.models.map((m) => m.id)).toEqual(["gpt-4.1", "claude-opus-4.6", "gpt-5.4"]);
    expect(result.models[0].supportsReasoningEffort).toBe(true);
    expect(result.models[0].supportedReasoningEfforts).toEqual(["low", "medium", "high"]);
    expect(result.models[0].defaultReasoningEffort).toBe("medium");
    expect(listModelsMock).toHaveBeenCalledTimes(1);
  });

  it("uses fresh cache without calling the SDK", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "copilot-models-cache.json"),
      `${JSON.stringify({
        fetchedAt: "2026-03-13T10:00:00.000Z",
        models: [{ id: "gpt-5.4", label: "GPT-5.4" }],
      })}\n`,
      "utf-8",
    );

    getClientMock.mockReturnValue({ listModels: listModelsMock });

    const { loadModelCatalog } = await import("./model-catalog.js");
    const result = await loadModelCatalog({ now: Date.parse("2026-03-13T12:00:00.000Z") });

    expect(result.source).toBe("cache");
    expect(result.models).toEqual([{ id: "gpt-5.4", label: "GPT-5.4" }]);
    expect(listModelsMock).not.toHaveBeenCalled();
  });

  it("refreshes stale cache from the Copilot SDK", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "copilot-models-cache.json"),
      `${JSON.stringify({
        fetchedAt: "2026-03-11T10:00:00.000Z",
        models: [{ id: "old-model", label: "Old model" }],
      })}\n`,
      "utf-8",
    );

    listModelsMock.mockResolvedValue([createModel("gpt-5.4", "GPT-5.4")]);
    getClientMock.mockReturnValue({ listModels: listModelsMock });

    const { loadModelCatalog } = await import("./model-catalog.js");
    const result = await loadModelCatalog({ now: Date.parse("2026-03-13T12:00:00.000Z") });

    expect(result.source).toBe("network");
    expect(result.models[0].id).toBe("gpt-5.4");
    expect(result.models[0].label).toBe("GPT-5.4");
    expect(listModelsMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to stale cache when SDK refresh fails", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "copilot-models-cache.json"),
      `${JSON.stringify({
        fetchedAt: "2026-03-11T10:00:00.000Z",
        models: [{ id: "cached-model", label: "Cached model" }],
      })}\n`,
      "utf-8",
    );

    listModelsMock.mockRejectedValue(new Error("sdk down"));
    getClientMock.mockReturnValue({ listModels: listModelsMock });

    const { loadModelCatalog } = await import("./model-catalog.js");
    const result = await loadModelCatalog({ now: Date.parse("2026-03-13T12:00:00.000Z") });

    expect(result.source).toBe("stale-cache");
    expect(result.stale).toBe(true);
    expect(result.models).toEqual([{ id: "cached-model", label: "Cached model" }]);
  });

  it("throws when SDK refresh fails and no cache exists", async () => {
    getClientMock.mockReturnValue(null);

    const { loadModelCatalog } = await import("./model-catalog.js");

    await expect(loadModelCatalog()).rejects.toThrow("Copilot client is not started");
  });

  it("captures reasoning effort capabilities from model info", async () => {
    listModelsMock.mockResolvedValue([
      createModel("claude-sonnet-4", "Claude Sonnet 4", "enabled", {
        supported: true,
        levels: ["low", "medium", "high", "xhigh"],
        defaultLevel: "high",
      }),
      createModel("gpt-4.1-nano", "GPT-4.1 Nano", "enabled", { supported: false }),
    ]);
    getClientMock.mockReturnValue({ listModels: listModelsMock });

    const { loadModelCatalog } = await import("./model-catalog.js");
    const result = await loadModelCatalog();

    const sonnet = result.models.find((m) => m.id === "claude-sonnet-4")!;
    expect(sonnet.supportsReasoningEffort).toBe(true);
    expect(sonnet.supportedReasoningEfforts).toEqual(["low", "medium", "high", "xhigh"]);
    expect(sonnet.defaultReasoningEffort).toBe("high");

    const nano = result.models.find((m) => m.id === "gpt-4.1-nano")!;
    expect(nano.supportsReasoningEffort).toBeUndefined();
    expect(nano.supportedReasoningEfforts).toBeUndefined();
  });
});

describe("getModelReasoningInfo", () => {
  it("returns reasoning capabilities for a known model", async () => {
    listModelsMock.mockResolvedValue([
      createModel("claude-sonnet-4", "Claude Sonnet 4", "enabled", {
        supported: true,
        levels: ["low", "medium", "high"],
        defaultLevel: "medium",
      }),
    ]);
    getClientMock.mockReturnValue({ listModels: listModelsMock });

    const { getModelReasoningInfo } = await import("./model-catalog.js");
    const info = await getModelReasoningInfo("claude-sonnet-4");

    expect(info).toEqual({
      supported: true,
      levels: ["low", "medium", "high"],
      defaultLevel: "medium",
    });
  });

  it("returns null for an unknown model", async () => {
    listModelsMock.mockResolvedValue([createModel("gpt-4.1", "GPT-4.1")]);
    getClientMock.mockReturnValue({ listModels: listModelsMock });

    const { getModelReasoningInfo } = await import("./model-catalog.js");
    const info = await getModelReasoningInfo("nonexistent-model");

    expect(info).toBeNull();
  });
});
