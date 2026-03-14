export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

let _currentLevel: LogLevel = "info";
let _logger: import("pino").Logger | null = null;

export function setLogLevel(level: LogLevel) {
  _currentLevel = level;
  if (_logger) _logger.level = level;
}

export function getLogLevel(): LogLevel {
  return _currentLevel;
}

export async function createLogger(level: LogLevel, logDir: string) {
  const pino = (await import("pino")).default;
  const { join } = await import("node:path");
  const { mkdirSync } = await import("node:fs");

  mkdirSync(logDir, { recursive: true });

  _currentLevel = level;

  const targets: import("pino").TransportTargetOptions[] = [
    {
      target: "pino/file",
      options: { destination: join(logDir, "neo.log"), mkdir: true },
      level,
    },
    {
      target: "pino/file",
      options: { destination: 1 }, // stdout
      level,
    },
  ];

  _logger = pino({
    level,
    transport: { targets },
    redact: {
      paths: [
        "telegram.botToken",
        "github.token",
        "env.GITHUB_TOKEN",
        "env.TELEGRAM_BOT_TOKEN",
        "env.NEO_BROWSER_CREDENTIALS_JSON",
      ],
      censor: "[REDACTED]",
    },
  });

  return _logger;
}

export function getLogger() {
  if (!_logger) throw new Error("Logger not initialized — call createLogger() first");
  return _logger;
}
