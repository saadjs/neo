import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ModelInfo } from "@github/copilot-sdk";
import type { ReasoningEffort } from "../agent";
import { getClient } from "../agent";
import { config } from "../config";
import {
  getConfiguredProviders,
  fetchProviderModels,
  qualifyModel,
  type ProviderEntry,
} from "../providers";
import { getLogger } from "../logging/index";

const MODEL_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const MODEL_CATALOG_CACHE_FILE = join(config.paths.data, "copilot-models-cache.json");

export interface AvailableModel {
  id: string;
  label: string;
  provider: string;
  supportsReasoningEffort?: boolean;
  supportedReasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
}

interface ModelCatalogCache {
  fetchedAt: string;
  providerSignature?: string;
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
    (candidate.providerSignature === undefined ||
      typeof candidate.providerSignature === "string") &&
    Array.isArray(candidate.models) &&
    candidate.models.every(isAvailableModel)
  );
}

function getProviderCatalogSignature(): string {
  const providers = getConfiguredProviders()
    .map((provider) => ({
      key: provider.key,
      label: provider.label,
      type: provider.type,
      baseUrl: provider.baseUrl,
      authMode: provider.bearerToken ? "bearer" : provider.apiKey ? "api-key" : "none",
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return JSON.stringify(providers);
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

  const label = `${value.name.trim() || id} [copilot]`;
  const supportsReasoningEffort = value.capabilities?.supports?.reasoningEffort ?? false;

  return {
    id,
    label,
    provider: "copilot",
    ...(supportsReasoningEffort && {
      supportsReasoningEffort: true,
      supportedReasoningEfforts: value.supportedReasoningEfforts,
      defaultReasoningEffort: value.defaultReasoningEffort,
    }),
  };
}

async function fetchCopilotModels(forceRefresh: boolean): Promise<AvailableModel[]> {
  const client = getClient();
  if (!client) {
    throw new Error("Copilot client is not started");
  }

  if (forceRefresh) {
    (client as unknown as Record<string, unknown>).modelsCache = null;
  }

  const payload = await client.listModels();
  const models = payload.map(normalizeModel).filter((value) => value !== null);
  if (models.length === 0) {
    throw new Error("Copilot models response did not contain any usable models");
  }

  return models;
}

async function fetchBYOKModels(provider: ProviderEntry): Promise<AvailableModel[]> {
  const models = await fetchProviderModels(provider);
  return models.map((m) => ({
    id: qualifyModel(provider.key, m.id),
    label: `${m.name} [${provider.label}]`,
    provider: provider.key,
  }));
}

async function fetchAllModels(forceRefresh: boolean): Promise<ModelCatalogCache> {
  const log = getLogger();
  const providers = getConfiguredProviders();

  let copilotModels: AvailableModel[] = [];
  let copilotError: unknown = null;

  try {
    copilotModels = await fetchCopilotModels(forceRefresh);
  } catch (err) {
    copilotError = err;
    log.warn({ err }, "Failed to fetch Copilot models");
  }

  const byokResults = await Promise.all(
    providers.map(async (provider) => {
      try {
        return await fetchBYOKModels(provider);
      } catch (err) {
        log.warn({ provider: provider.key, err }, "Failed to fetch BYOK models");
        return [];
      }
    }),
  );

  const byokModels = byokResults.flat();

  if (copilotModels.length === 0 && byokModels.length === 0) {
    if (copilotError) throw copilotError;
    throw new Error("No models available from any provider");
  }

  // Copilot first, then BYOK providers sorted alphabetically by provider key
  const sortedByok = [...byokModels].sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.id.localeCompare(b.id);
  });

  return {
    fetchedAt: new Date().toISOString(),
    providerSignature: getProviderCatalogSignature(),
    models: [...copilotModels, ...sortedByok],
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
  const providerSignature = getProviderCatalogSignature();

  if (
    !options?.forceRefresh &&
    cache &&
    isFresh(cache.fetchedAt, now) &&
    cache.providerSignature === providerSignature
  ) {
    return {
      fetchedAt: cache.fetchedAt,
      models: cache.models,
      source: "cache",
      stale: false,
    };
  }

  try {
    const fresh = await fetchAllModels(options?.forceRefresh ?? false);
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
