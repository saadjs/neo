import { COPILOT_USAGE_FETCH_TIMEOUT_MS } from "../constants";
import type { ProviderEntry } from "../providers";

export interface CopilotQuotaSnapshot {
  percentRemaining: number;
  remaining: number | null;
  entitlement: number | null;
}

export interface CopilotUsageSnapshot {
  premiumInteractions: CopilotQuotaSnapshot | null;
  chat: CopilotQuotaSnapshot | null;
  resetsIn: string;
  resetAt: string | null;
  plan: string | null;
}

export interface TokenUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  requestCount: number | null;
  windowStart: string;
  windowEnd: string;
}

export interface VercelCreditsSnapshot {
  balance: string | null;
  totalUsed: string | null;
}

export type ProviderUsageSnapshot =
  | { kind: "copilot"; usage: CopilotUsageSnapshot }
  | { kind: "anthropic"; usage: TokenUsageSnapshot }
  | { kind: "openai"; usage: TokenUsageSnapshot }
  | { kind: "vercel"; usage: VercelCreditsSnapshot };

export interface ProviderUsageReport {
  providerKey: string;
  label: string;
  ok: boolean;
  snapshot?: ProviderUsageSnapshot;
  error?: string;
}

export interface RequestConfig {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  nowMs?: number;
}

interface OpenAiUsageBucketResult {
  input_tokens?: unknown;
  output_tokens?: unknown;
  num_model_requests?: unknown;
  input_cached_tokens?: unknown;
  input_uncached_tokens?: unknown;
  input_text_tokens?: unknown;
  output_text_tokens?: unknown;
  input_cached_text_tokens?: unknown;
  input_audio_tokens?: unknown;
  input_cached_audio_tokens?: unknown;
  output_audio_tokens?: unknown;
  input_image_tokens?: unknown;
  input_cached_image_tokens?: unknown;
  output_image_tokens?: unknown;
}

interface AnthropicUsageBucketResult {
  requests?: unknown;
  uncached_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation?: Record<string, unknown>;
  output_tokens?: unknown;
  server_tool_use?: {
    web_search_requests?: unknown;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "request timeout";
    return error.message || String(error);
  }

  return String(error);
}

async function requestJson(
  url: string,
  init: RequestInit,
  config: RequestConfig = {},
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const fetchFn = config.fetchFn ?? fetch;
  const timeoutMs = config.timeoutMs ?? COPILOT_USAGE_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    try {
      return { ok: true, data: await response.json() };
    } catch {
      return { ok: false, error: "invalid JSON response" };
    }
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "now";

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const formatPart = (value: number, unit: string): string =>
    `${value} ${unit}${value === 1 ? "" : "s"}`;

  const parts = [
    days > 0 ? formatPart(days, "day") : null,
    hours > 0 ? formatPart(hours, "hour") : null,
    minutes > 0 ? formatPart(minutes, "minute") : null,
  ].filter(Boolean);

  if (parts.length > 0) return parts.slice(0, 2).join(" ");
  return "<1 minute";
}

export function formatResetsAt(isoDate: string, nowMs = Date.now()): string {
  const resetTime = new Date(isoDate).getTime();
  if (!Number.isFinite(resetTime)) return "";

  const diffSeconds = Math.max(0, (resetTime - nowMs) / 1000);
  return formatDuration(diffSeconds);
}

function nextUtcMonthBoundaryMs(nowMs = Date.now()): number {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0);
}

function resolveCopilotResetAt(data: Record<string, unknown>, nowMs = Date.now()): string {
  const quotaResetDate = data.quota_reset_date;
  if (typeof quotaResetDate === "string") {
    const parsed = new Date(quotaResetDate).getTime();
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  return new Date(nextUtcMonthBoundaryMs(nowMs)).toISOString();
}

function copilotResetCountdown(resetAt: string, nowMs = Date.now()): string {
  return formatResetsAt(resetAt, nowMs);
}

function readPercentRemaining(snapshot: Record<string, unknown>): number | null {
  const direct = readNumber(snapshot.percent_remaining);
  if (direct != null) return clampPercent(direct);

  const entitlement = readNumber(snapshot.entitlement);
  const remaining = readNumber(snapshot.remaining);
  if (entitlement != null && entitlement > 0 && remaining != null) {
    return clampPercent((remaining / entitlement) * 100);
  }

  return null;
}

function getCopilotSnapshot(
  data: Record<string, unknown>,
  key: "premium_interactions" | "chat",
): Record<string, unknown> | null {
  const quotaSnapshots = asRecord(data.quota_snapshots);
  const direct = quotaSnapshots ? asRecord(quotaSnapshots[key]) : null;
  if (direct) return direct;

  const monthlyQuotas = asRecord(data.monthly_quotas);
  const limitedUserQuotas = asRecord(data.limited_user_quotas);

  if (key === "premium_interactions") {
    const entitlement = monthlyQuotas ? readNumber(monthlyQuotas.completions) : null;
    const remaining = limitedUserQuotas ? readNumber(limitedUserQuotas.completions) : null;
    if (entitlement != null || remaining != null) {
      return { entitlement, remaining };
    }
  }

  const entitlement = monthlyQuotas ? readNumber(monthlyQuotas.chat) : null;
  const remaining = limitedUserQuotas ? readNumber(limitedUserQuotas.chat) : null;
  if (entitlement != null || remaining != null) {
    return { entitlement, remaining };
  }

  return null;
}

function parseQuotaSnapshot(snapshot: Record<string, unknown> | null): CopilotQuotaSnapshot | null {
  if (!snapshot) return null;

  const percentRemaining = readPercentRemaining(snapshot);
  if (percentRemaining == null) return null;

  return {
    percentRemaining,
    remaining: readNumber(snapshot.remaining),
    entitlement: readNumber(snapshot.entitlement),
  };
}

export function parseCopilotUsageSnapshot(
  data: unknown,
  nowMs = Date.now(),
): CopilotUsageSnapshot | null {
  const record = asRecord(data);
  if (!record) return null;

  const premiumInteractions = parseQuotaSnapshot(
    getCopilotSnapshot(record, "premium_interactions"),
  );
  const chat = parseQuotaSnapshot(getCopilotSnapshot(record, "chat"));

  if (!premiumInteractions && !chat) return null;

  const resetAt = resolveCopilotResetAt(record, nowMs);
  return {
    premiumInteractions,
    chat,
    resetAt,
    resetsIn: copilotResetCountdown(resetAt, nowMs),
    plan: typeof record.copilot_plan === "string" ? record.copilot_plan : null,
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function windowRange(nowMs = Date.now(), days = 30): { startMs: number; endMs: number } {
  const endMs = nowMs;
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  return { startMs, endMs };
}

function buildEmptyTokenUsageSnapshot(
  startMs: number,
  endMs: number,
  requestCount: number | null,
): TokenUsageSnapshot {
  return {
    inputTokens: 0,
    outputTokens: 0,
    requestCount,
    windowStart: new Date(startMs).toISOString(),
    windowEnd: new Date(endMs).toISOString(),
  };
}

function readDataArray(data: unknown): unknown[] | null {
  const record = asRecord(data);
  return Array.isArray(record?.data) ? record.data : null;
}

function sumNumbers(values: Array<unknown>): number {
  let total = 0;

  for (const value of values) {
    total += readNumber(value) ?? 0;
  }

  return total;
}

function sumAnthropicCacheCreationTokens(cacheCreation: unknown): number {
  const record = asRecord(cacheCreation);
  if (!record) return 0;

  let total = 0;
  for (const value of Object.values(record)) {
    total += readNumber(value) ?? 0;
  }

  return total;
}

function readOpenAiInputTokens(usage: OpenAiUsageBucketResult): number {
  const total = readNumber(usage.input_tokens);
  const detailedTotal = sumNumbers([
    usage.input_uncached_tokens,
    usage.input_cached_tokens,
    usage.input_audio_tokens,
    usage.input_cached_audio_tokens,
    usage.input_image_tokens,
    usage.input_cached_image_tokens,
  ]);

  if (total != null) {
    return Math.max(total, detailedTotal);
  }

  if (detailedTotal > 0) {
    return detailedTotal;
  }

  return sumNumbers([usage.input_text_tokens, usage.input_audio_tokens, usage.input_image_tokens]);
}

function readOpenAiOutputTokens(usage: OpenAiUsageBucketResult): number {
  const total = readNumber(usage.output_tokens);
  const detailedTotal = sumNumbers([
    usage.output_text_tokens,
    usage.output_audio_tokens,
    usage.output_image_tokens,
  ]);

  if (total != null) {
    return Math.max(total, detailedTotal);
  }

  return detailedTotal;
}

function sumOpenAiUsageBuckets(data: unknown): TokenUsageSnapshot | null {
  const buckets = readDataArray(data);
  if (!buckets) return null;

  let inputTokens = 0;
  let outputTokens = 0;
  let requestCount = 0;
  let windowStart: string | null = null;
  let windowEnd: string | null = null;

  for (const bucket of buckets) {
    const bucketRecord = asRecord(bucket);
    if (!bucketRecord) continue;

    const startTime = readNumber(bucketRecord.start_time);
    const endTime = readNumber(bucketRecord.end_time);
    if (windowStart == null && startTime != null) {
      windowStart = new Date(startTime * 1000).toISOString();
    }
    if (endTime != null) {
      windowEnd = new Date(endTime * 1000).toISOString();
    }

    const results = Array.isArray(bucketRecord.results) ? bucketRecord.results : [];
    for (const result of results) {
      const usage = result as OpenAiUsageBucketResult;
      inputTokens += readOpenAiInputTokens(usage);
      outputTokens += readOpenAiOutputTokens(usage);
      requestCount += readNumber(usage.num_model_requests) ?? 0;
    }
  }

  if (windowStart == null || windowEnd == null) return null;

  return {
    inputTokens,
    outputTokens,
    requestCount,
    windowStart,
    windowEnd,
  };
}

function sumAnthropicUsageBuckets(data: unknown): TokenUsageSnapshot | null {
  const buckets = readDataArray(data);
  if (!buckets) return null;

  let inputTokens = 0;
  let outputTokens = 0;
  let requestCount: number | null = 0;
  let windowStart: string | null = null;
  let windowEnd: string | null = null;

  for (const bucket of buckets) {
    const bucketRecord = asRecord(bucket);
    if (!bucketRecord) continue;

    const bucketStart = readString(bucketRecord.starting_at);
    const bucketEnd = readString(bucketRecord.ending_at);
    if (windowStart == null && bucketStart) windowStart = bucketStart;
    if (bucketEnd) windowEnd = bucketEnd;

    const results = Array.isArray(bucketRecord.results) ? bucketRecord.results : [];
    for (const result of results) {
      const usage = result as AnthropicUsageBucketResult;
      inputTokens += sumNumbers([
        usage.uncached_input_tokens,
        usage.cache_creation_input_tokens,
        usage.cache_read_input_tokens,
      ]);
      inputTokens += sumAnthropicCacheCreationTokens(usage.cache_creation);
      outputTokens += readNumber(usage.output_tokens) ?? 0;

      const requests = readNumber(usage.requests);
      if (requests == null) {
        requestCount = null;
      } else if (requestCount != null) {
        requestCount += requests;
      }
    }
  }

  if (windowStart == null || windowEnd == null) return null;

  return {
    inputTokens,
    outputTokens,
    requestCount,
    windowStart,
    windowEnd,
  };
}

function parseVercelCreditsSnapshot(data: unknown): VercelCreditsSnapshot | null {
  const record = asRecord(data);
  if (!record) return null;

  const balance = readString(record.balance);
  const totalUsed = readString(record.total_used);
  if (balance == null && totalUsed == null) return null;

  return {
    balance,
    totalUsed,
  };
}

export async function fetchCopilotUsage(
  token: string,
  config: RequestConfig = {},
): Promise<{ ok: true; usage: CopilotUsageSnapshot } | { ok: false; error: string }> {
  const result = await requestJson(
    "https://api.github.com/copilot_internal/user",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Editor-Version": "vscode/1.107.0",
        "Editor-Plugin-Version": "copilot-chat/0.35.0",
        "User-Agent": "GitHubCopilotChat/0.35.0",
        "Copilot-Integration-Id": "vscode-chat",
        "X-Github-Api-Version": "2025-04-01",
      },
    },
    config,
  );

  if (!result.ok) {
    return result;
  }

  const usage = parseCopilotUsageSnapshot(result.data, config.nowMs);
  if (!usage) {
    return { ok: false, error: "unrecognized response shape" };
  }

  return { ok: true, usage };
}

export async function fetchVercelUsage(
  provider: ProviderEntry,
  config: RequestConfig = {},
): Promise<ProviderUsageReport> {
  const token = provider.bearerToken ?? provider.apiKey;
  if (!token) {
    return {
      providerKey: provider.key,
      label: provider.label,
      ok: false,
      error: "missing API token",
    };
  }

  const result = await requestJson(
    "https://ai-gateway.vercel.sh/v1/credits",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
    config,
  );

  if (!result.ok) {
    return {
      providerKey: provider.key,
      label: provider.label,
      ok: false,
      error: result.error,
    };
  }

  const usage = parseVercelCreditsSnapshot(result.data);
  if (!usage) {
    return {
      providerKey: provider.key,
      label: provider.label,
      ok: false,
      error: "unrecognized response shape",
    };
  }

  return {
    providerKey: provider.key,
    label: provider.label,
    ok: true,
    snapshot: { kind: "vercel", usage },
  };
}

export async function fetchAnthropicUsage(
  provider: ProviderEntry,
  config: RequestConfig = {},
): Promise<ProviderUsageReport> {
  const apiKey = provider.adminApiKey ?? provider.apiKey ?? provider.bearerToken;
  if (!apiKey) {
    return {
      providerKey: provider.key,
      label: provider.label,
      ok: false,
      error: "missing API key",
    };
  }

  const { startMs, endMs } = windowRange(config.nowMs);
  const url = new URL("https://api.anthropic.com/v1/organizations/usage_report/messages");
  url.searchParams.set("starting_at", new Date(startMs).toISOString());
  url.searchParams.set("ending_at", new Date(endMs).toISOString());
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("limit", "30");

  const result = await requestJson(
    url.toString(),
    {
      headers: {
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
      },
    },
    config,
  );

  if (!result.ok) {
    return {
      providerKey: provider.key,
      label: provider.label,
      ok: false,
      error: result.error,
    };
  }

  const usage = sumAnthropicUsageBuckets(result.data);
  if (!usage) {
    const buckets = readDataArray(result.data);
    if (buckets?.length === 0) {
      return {
        providerKey: provider.key,
        label: provider.label,
        ok: true,
        snapshot: {
          kind: "anthropic",
          usage: buildEmptyTokenUsageSnapshot(startMs, endMs, 0),
        },
      };
    }

    return {
      providerKey: provider.key,
      label: provider.label,
      ok: false,
      error: "unrecognized response shape",
    };
  }

  return {
    providerKey: provider.key,
    label: provider.label,
    ok: true,
    snapshot: { kind: "anthropic", usage },
  };
}

export async function fetchOpenAiUsage(
  provider: ProviderEntry,
  config: RequestConfig = {},
): Promise<ProviderUsageReport> {
  const apiKey = provider.adminApiKey ?? provider.apiKey ?? provider.bearerToken;
  if (!apiKey) {
    return {
      providerKey: provider.key,
      label: provider.label,
      ok: false,
      error: "missing API key",
    };
  }

  const { startMs, endMs } = windowRange(config.nowMs);
  const url = new URL("https://api.openai.com/v1/organization/usage/completions");
  url.searchParams.set("start_time", String(Math.floor(startMs / 1000)));
  url.searchParams.set("end_time", String(Math.floor(endMs / 1000)));
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("limit", "30");

  const result = await requestJson(
    url.toString(),
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
    config,
  );

  if (!result.ok) {
    return {
      providerKey: provider.key,
      label: provider.label,
      ok: false,
      error: result.error,
    };
  }

  const usage = sumOpenAiUsageBuckets(result.data);
  if (!usage) {
    const buckets = readDataArray(result.data);
    if (buckets?.length === 0) {
      return {
        providerKey: provider.key,
        label: provider.label,
        ok: true,
        snapshot: {
          kind: "openai",
          usage: buildEmptyTokenUsageSnapshot(startMs, endMs, 0),
        },
      };
    }

    return {
      providerKey: provider.key,
      label: provider.label,
      ok: false,
      error: "unrecognized response shape",
    };
  }

  return {
    providerKey: provider.key,
    label: provider.label,
    ok: true,
    snapshot: { kind: "openai", usage },
  };
}

export async function fetchProviderUsage(
  provider: ProviderEntry,
  config: RequestConfig = {},
): Promise<ProviderUsageReport> {
  if (provider.key === "vercel") {
    return fetchVercelUsage(provider, config);
  }

  if (provider.key === "anthropic") {
    return fetchAnthropicUsage(provider, config);
  }

  if (provider.key === "openai") {
    return fetchOpenAiUsage(provider, config);
  }

  return {
    providerKey: provider.key,
    label: provider.label,
    ok: false,
    error: "usage API not supported",
  };
}
