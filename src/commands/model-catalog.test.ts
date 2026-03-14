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
): ModelInfo {
  return {
    id,
    name,
    capabilities: {
      supports: {
        vision: false,
        reasoningEffort: true,
      },
      limits: {
        max_context_window_tokens: 200000,
      },
    },
    policy: {
      state: policyState,
      terms: "",
    },
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
    expect(result.models.map((model) => model.id)).toEqual([
      "gpt-4.1",
      "claude-opus-4.6",
      "gpt-5.4",
    ]);
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
    expect(result.models).toEqual([{ id: "gpt-5.4", label: "GPT-5.4" }]);
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
});
