import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { dataDir } = vi.hoisted(() => ({
  dataDir: "/tmp/neo-model-catalog-test",
}));

vi.mock("../config.js", () => ({
  config: {
    github: { token: "github-token" },
    paths: { data: dataDir },
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("loadModelCatalog", () => {
  it("fetches from GitHub and persists the cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "gpt-4.1", name: "GPT-4.1" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const { loadModelCatalog } = await import("./model-catalog.js");
    const result = await loadModelCatalog();

    expect(result.source).toBe("network");
    expect(result.stale).toBe(false);
    expect(result.models).toEqual([{ id: "gpt-4.1", label: "GPT-4.1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the fresh daily cache without refetching", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "github-models-cache.json"),
      `${JSON.stringify({
        fetchedAt: "2026-03-13T10:00:00.000Z",
        models: [{ id: "gpt-4.1", label: "GPT-4.1" }],
      })}\n`,
      "utf-8",
    );

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { loadModelCatalog } = await import("./model-catalog.js");
    const result = await loadModelCatalog({ now: Date.parse("2026-03-13T12:00:00.000Z") });

    expect(result.source).toBe("cache");
    expect(result.models).toEqual([{ id: "gpt-4.1", label: "GPT-4.1" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes the cache after 24 hours", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "github-models-cache.json"),
      `${JSON.stringify({
        fetchedAt: "2026-03-11T10:00:00.000Z",
        models: [{ id: "old-model", label: "Old Model" }],
      })}\n`,
      "utf-8",
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "gpt-5", name: "GPT-5" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const { loadModelCatalog } = await import("./model-catalog.js");
    const result = await loadModelCatalog({ now: Date.parse("2026-03-13T12:00:00.000Z") });

    expect(result.source).toBe("network");
    expect(result.models).toEqual([{ id: "gpt-5", label: "GPT-5" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to stale cache when refresh fails", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "github-models-cache.json"),
      `${JSON.stringify({
        fetchedAt: "2026-03-11T10:00:00.000Z",
        models: [{ id: "cached-model", label: "Cached Model" }],
      })}\n`,
      "utf-8",
    );

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const { loadModelCatalog } = await import("./model-catalog.js");
    const result = await loadModelCatalog({ now: Date.parse("2026-03-13T12:00:00.000Z") });

    expect(result.source).toBe("stale-cache");
    expect(result.stale).toBe(true);
    expect(result.models).toEqual([{ id: "cached-model", label: "Cached Model" }]);
  });

  it("throws when refresh fails and there is no cache", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const { loadModelCatalog } = await import("./model-catalog.js");

    await expect(loadModelCatalog()).rejects.toThrow("network down");
  });
});
