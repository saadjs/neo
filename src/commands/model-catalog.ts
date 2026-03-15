import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ModelInfo } from "@github/copilot-sdk";
import type { ReasoningEffort } from "../agent.js";
import { getClient } from "../agent.js";
import { config } from "../config.js";

const MODEL_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const MODEL_CATALOG_CACHE_FILE = join(config.paths.data, "copilot-models-cache.json");

export interface AvailableModel {
  id: string;
  label: string;
  supportsReasoningEffort?: boolean;
  supportedReasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
}

interface ModelCatalogCache {
  fetchedAt: string;
  models: AvailableModel[];
}

export interface ModelCatalogResult {
  fetchedAt: string;
  models: AvailableModel[];
  source: "network" | "cache" | "stale-cache";
  stale: boolean;
}

function isAvailableModel(value: unknown): value is AvailableModel {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.label === "string";
}

function isModelCatalogCache(value: unknown): value is ModelCatalogCache {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.fetchedAt === "string" &&
    Array.isArray(candidate.models) &&
    candidate.models.every(isAvailableModel)
  );
}

async function readModelCatalogCache(): Promise<ModelCatalogCache | null> {
  try {
    const raw = await readFile(MODEL_CATALOG_CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return isModelCatalogCache(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeModelCatalogCache(cache: ModelCatalogCache): Promise<void> {
  await mkdir(dirname(MODEL_CATALOG_CACHE_FILE), { recursive: true });
  await writeFile(MODEL_CATALOG_CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, "utf-8");
}

function normalizeModel(value: ModelInfo): AvailableModel | null {
  if (!value || typeof value !== "object") return null;
  if (value.policy?.state === "disabled") return null;

  const id = value.id.trim();
  if (!id) return null;

  const label = value.name.trim() || id;
  const supportsReasoningEffort = value.capabilities?.supports?.reasoningEffort ?? false;

  return {
    id,
    label,
    ...(supportsReasoningEffort && {
      supportsReasoningEffort: true,
      supportedReasoningEfforts: value.supportedReasoningEfforts,
      defaultReasoningEffort: value.defaultReasoningEffort,
    }),
  };
}

async function fetchModelCatalogFromCopilot(): Promise<ModelCatalogCache> {
  const client = getClient();
  if (!client) {
    throw new Error("Copilot client is not started");
  }

  const payload = await client.listModels();
  const models = payload.map(normalizeModel).filter((value) => value !== null);
  if (models.length === 0) {
    throw new Error("Copilot models response did not contain any usable models");
  }

  return {
    fetchedAt: new Date().toISOString(),
    models,
  };
}

function isFresh(fetchedAt: string, now: number): boolean {
  const timestamp = Date.parse(fetchedAt);
  if (Number.isNaN(timestamp)) return false;
  return now - timestamp < MODEL_CATALOG_TTL_MS;
}

export async function loadModelCatalog(options?: {
  forceRefresh?: boolean;
  now?: number;
}): Promise<ModelCatalogResult> {
  const now = options?.now ?? Date.now();
  const cache = await readModelCatalogCache();

  if (!options?.forceRefresh && cache && isFresh(cache.fetchedAt, now)) {
    return {
      fetchedAt: cache.fetchedAt,
      models: cache.models,
      source: "cache",
      stale: false,
    };
  }

  try {
    const fresh = await fetchModelCatalogFromCopilot();
    await writeModelCatalogCache(fresh);
    return {
      fetchedAt: fresh.fetchedAt,
      models: fresh.models,
      source: "network",
      stale: false,
    };
  } catch (error) {
    if (cache) {
      return {
        fetchedAt: cache.fetchedAt,
        models: cache.models,
        source: "stale-cache",
        stale: true,
      };
    }
    throw error;
  }
}

export async function getModelReasoningInfo(modelId: string): Promise<{
  supported: boolean;
  levels: ReasoningEffort[];
  defaultLevel: ReasoningEffort | undefined;
} | null> {
  try {
    const catalog = await loadModelCatalog();
    const model = catalog.models.find((m) => m.id === modelId);
    if (!model) return null;

    return {
      supported: model.supportsReasoningEffort ?? false,
      levels: model.supportedReasoningEfforts ?? [],
      defaultLevel: model.defaultReasoningEffort,
    };
  } catch {
    return null;
  }
}
