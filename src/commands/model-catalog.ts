import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.js";

const MODEL_CATALOG_URL = "https://models.github.ai/catalog/models";
const MODEL_CATALOG_API_VERSION = "2026-03-10";
const MODEL_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const MODEL_CATALOG_CACHE_FILE = join(config.paths.data, "github-models-cache.json");

export interface AvailableModel {
  id: string;
  label: string;
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

function normalizeModel(value: unknown): AvailableModel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return null;

  const id = candidate.id.trim();
  const label =
    typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : id;

  return { id, label };
}

async function fetchModelCatalogFromGithub(): Promise<ModelCatalogCache> {
  const response = await fetch(MODEL_CATALOG_URL, {
    headers: {
      Authorization: `Bearer ${config.github.token}`,
      "X-GitHub-Api-Version": MODEL_CATALOG_API_VERSION,
      Accept: "application/json",
      "User-Agent": "Neo/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub models request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("GitHub models response was not an array");
  }

  const models = payload.map(normalizeModel).filter((value) => value !== null);
  if (models.length === 0) {
    throw new Error("GitHub models response did not contain any usable models");
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
    const fresh = await fetchModelCatalogFromGithub();
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
