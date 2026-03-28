export interface SessionErrorSummary {
  message: string;
  statusCode?: number;
  code?: string;
  userFacingMessage?: string;
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pickNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function classifyError(
  statusCode: number | undefined,
  code: string | undefined,
  message: string,
  errorType: string | undefined,
): string | undefined {
  const normalized =
    `${statusCode ?? ""} ${code ?? ""} ${message} ${errorType ?? ""}`.toLowerCase();

  if (
    errorType === "quota" ||
    statusCode === 402 ||
    code === "quota_exceeded" ||
    normalized.includes("you have no quota") ||
    normalized.includes("quota exceed") ||
    normalized.includes("premium interactions") ||
    normalized.includes("usage limit")
  ) {
    return "quota";
  }

  if (errorType === "rate_limit" || statusCode === 429 || normalized.includes("rate limit")) {
    return "rate_limit";
  }

  if (
    errorType === "authentication" ||
    errorType === "authorization" ||
    statusCode === 401 ||
    statusCode === 403 ||
    normalized.includes("auth")
  ) {
    return "authentication";
  }

  return undefined;
}

function buildUserFacingMessage(
  kind: string | undefined,
  statusCode: number | undefined,
  code: string | undefined,
  message: string,
): string | undefined {
  const prefix = statusCode ? `Copilot API error: ${statusCode}` : "Copilot API error:";
  const headline = code
    ? `${prefix} ${code}${message ? ` - ${message}` : ""}`
    : `${prefix}${message ? ` ${message}` : ""}`;

  if (kind === "quota") {
    return `${headline}\n\nUse /usage to check reset time, or /model to switch providers.`;
  }

  if (kind === "rate_limit") {
    return `${headline}\n\nTry again in a moment, or /model to switch providers.`;
  }

  if (kind === "authentication") {
    return `${headline}\n\nCheck the provider credentials before retrying.`;
  }

  return undefined;
}

export function summarizeSessionError(error: unknown): SessionErrorSummary | null {
  if (!error) return null;

  if (typeof error === "string") {
    const kind = classifyError(undefined, undefined, error, undefined);
    return {
      message: error,
      userFacingMessage: buildUserFacingMessage(kind, undefined, undefined, error),
    };
  }

  if (typeof error !== "object") {
    const message = String(error);
    return { message };
  }

  const obj = error as Record<string, unknown>;
  const nested =
    obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : undefined;

  const statusCode = pickNumber(obj.statusCode) ?? pickNumber(obj.status);
  const code = pickString(obj.code) ?? pickString(nested?.code);
  const errorType = pickString(obj.errorType);
  const message =
    pickString(obj.message) ??
    pickString(nested?.message) ??
    (Object.keys(obj).length > 0 ? JSON.stringify(obj) : String(error));

  const kind = classifyError(statusCode, code, message, errorType);

  return {
    message,
    statusCode,
    code,
    userFacingMessage: buildUserFacingMessage(kind, statusCode, code, message),
  };
}
