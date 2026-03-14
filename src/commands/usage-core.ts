export interface CopilotQuotaSnapshot {
  percentRemaining: number;
  remaining: number | null;
  entitlement: number | null;
}

export interface CopilotUsageSnapshot {
  premiumInteractions: CopilotQuotaSnapshot | null;
  chat: CopilotQuotaSnapshot | null;
  resetsIn: string;
  plan: string | null;
}

export interface RequestConfig {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  nowMs?: number;
}

const DEFAULT_FETCH_TIMEOUT_MS = 12_000;

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
  const timeoutMs = config.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
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

function readCopilotNumber(value: unknown): number | null {
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

  if (days > 0 && hours > 0) return `${days}d ${hours}h`;
  if (days > 0) return `${days}d`;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
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

function copilotResetCountdown(data: Record<string, unknown>, nowMs = Date.now()): string {
  const quotaResetDate = data.quota_reset_date;
  if (typeof quotaResetDate === "string") {
    const formatted = formatResetsAt(quotaResetDate, nowMs);
    if (formatted) return formatted;
  }

  const nextBoundary = nextUtcMonthBoundaryMs(nowMs);
  return formatDuration(Math.max(0, (nextBoundary - nowMs) / 1000));
}

function readPercentRemaining(snapshot: Record<string, unknown>): number | null {
  const direct = readCopilotNumber(snapshot.percent_remaining);
  if (direct != null) return clampPercent(direct);

  const entitlement = readCopilotNumber(snapshot.entitlement);
  const remaining = readCopilotNumber(snapshot.remaining);
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
    const entitlement = monthlyQuotas ? readCopilotNumber(monthlyQuotas.completions) : null;
    const remaining = limitedUserQuotas ? readCopilotNumber(limitedUserQuotas.completions) : null;
    if (entitlement != null || remaining != null) {
      return { entitlement, remaining };
    }
  }

  const entitlement = monthlyQuotas ? readCopilotNumber(monthlyQuotas.chat) : null;
  const remaining = limitedUserQuotas ? readCopilotNumber(limitedUserQuotas.chat) : null;
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
    remaining: readCopilotNumber(snapshot.remaining),
    entitlement: readCopilotNumber(snapshot.entitlement),
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

  return {
    premiumInteractions,
    chat,
    resetsIn: copilotResetCountdown(record, nowMs),
    plan: typeof record.copilot_plan === "string" ? record.copilot_plan : null,
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
