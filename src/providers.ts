import { config } from "./config";
import { getLogger } from "./logging/index";

export interface ProviderEntry {
  key: string;
  label: string;
  type: "openai" | "anthropic";
  baseUrl: string;
  apiKey?: string;
  bearerToken?: string;
}

export interface ProviderConfig {
  type?: "openai" | "anthropic";
  wireApi?: "completions" | "responses";
  baseUrl: string;
  apiKey?: string;
  bearerToken?: string;
}

export interface ModelSelection {
  rawModel: string;
  providerKey: string | undefined;
}

export interface ProviderModelInfo {
  id: string;
  name: string;
}

let cachedProviders: ProviderEntry[] | null = null;

export function detectProviders(): ProviderEntry[] {
  const providers: ProviderEntry[] = [];

  if (config.providers.anthropicApiKey) {
    providers.push({
      key: "anthropic",
      label: "anthropic",
      type: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: config.providers.anthropicApiKey,
    });
  }

  if (config.providers.openaiApiKey) {
    providers.push({
      key: "openai",
      label: "openai",
      type: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: config.providers.openaiApiKey,
    });
  }

  const custom = config.providers.custom;
  if (custom.baseUrl) {
    providers.push({
      key: custom.name ?? "custom",
      label: custom.name ?? "custom",
      type: custom.type ?? "openai",
      baseUrl: custom.baseUrl,
      apiKey: custom.apiKey,
      bearerToken: custom.bearerToken,
    });
  }

  return providers;
}

export function getConfiguredProviders(): ProviderEntry[] {
  if (!cachedProviders) {
    cachedProviders = detectProviders();
  }
  return cachedProviders;
}

export function resetProviderCache(): void {
  cachedProviders = null;
}

export function getProvider(key: string): ProviderEntry | undefined {
  return getConfiguredProviders().find((p) => p.key === key);
}

export function buildProviderConfig(key: string): ProviderConfig | undefined {
  const provider = getProvider(key);
  if (!provider) return undefined;

  return {
    type: provider.type,
    baseUrl: provider.baseUrl,
    ...(provider.apiKey && { apiKey: provider.apiKey }),
    ...(provider.bearerToken && { bearerToken: provider.bearerToken }),
  };
}

export function parseQualifiedModel(qualifiedId: string): ModelSelection {
  const colonIndex = qualifiedId.indexOf(":");
  if (colonIndex === -1) {
    return { rawModel: qualifiedId, providerKey: undefined };
  }

  const prefix = qualifiedId.slice(0, colonIndex);
  const model = qualifiedId.slice(colonIndex + 1);

  // Only treat as qualified if the prefix matches a known provider
  const provider = getProvider(prefix);
  if (provider) {
    return { rawModel: model, providerKey: prefix };
  }

  // Not a known provider prefix — treat the whole string as a model ID
  return { rawModel: qualifiedId, providerKey: undefined };
}

export function qualifyModel(providerKey: string | undefined, modelId: string): string {
  if (!providerKey) return modelId;
  return `${providerKey}:${modelId}`;
}

const OPENAI_CHAT_PREFIXES = ["gpt-", "o1-", "o3-", "o4-", "chatgpt-"];

export async function fetchProviderModels(provider: ProviderEntry): Promise<ProviderModelInfo[]> {
  const log = getLogger();

  try {
    if (provider.type === "anthropic") {
      return await fetchAnthropicModels(provider);
    }
    return await fetchOpenAIModels(provider);
  } catch (err) {
    log.warn({ provider: provider.key, err }, "Failed to fetch models from provider");
    return [];
  }
}

async function fetchAnthropicModels(provider: ProviderEntry): Promise<ProviderModelInfo[]> {
  const url = `${provider.baseUrl}/v1/models`;
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
  };
  if (provider.bearerToken) {
    headers["Authorization"] = `Bearer ${provider.bearerToken}`;
  } else if (provider.apiKey) {
    headers["x-api-key"] = provider.apiKey;
  }

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`Anthropic API returned ${response.status}`);
  }

  const body = (await response.json()) as { data?: { id: string; display_name?: string }[] };
  if (!body.data || !Array.isArray(body.data)) return [];

  return body.data
    .filter((m) => m.id && typeof m.id === "string")
    .map((m) => ({
      id: m.id,
      name: m.display_name ?? m.id,
    }));
}

async function fetchOpenAIModels(provider: ProviderEntry): Promise<ProviderModelInfo[]> {
  const url = `${provider.baseUrl}/models`;
  const headers: Record<string, string> = {};
  if (provider.bearerToken) {
    headers["Authorization"] = `Bearer ${provider.bearerToken}`;
  } else if (provider.apiKey) {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  }

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`OpenAI-compatible API returned ${response.status}`);
  }

  const body = (await response.json()) as { data?: { id: string }[] };
  if (!body.data || !Array.isArray(body.data)) return [];

  // For well-known OpenAI, filter to chat models; for custom providers, return all
  if (provider.key === "openai") {
    return body.data
      .filter((m) => m.id && OPENAI_CHAT_PREFIXES.some((p) => m.id.startsWith(p)))
      .map((m) => ({ id: m.id, name: m.id }));
  }

  return body.data
    .filter((m) => m.id && typeof m.id === "string")
    .map((m) => ({ id: m.id, name: m.id }));
}
