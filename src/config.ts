import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const PROJECT_ROOT = resolve(".");
const DEFAULT_DATA_DIR = resolve(process.env.NEO_DATA_DIR?.trim() || join(homedir(), ".neo"));
const DEFAULT_LOG_DIR = resolve(process.env.NEO_LOG_DIR?.trim() || join(homedir(), ".neo", "logs"));
const DEFAULT_SKILL_DIRS = [join(PROJECT_ROOT, "skills"), join(homedir(), ".agents", "skills")];
const LOG_LEVELS = ["error", "warn", "info", "debug", "trace"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type ManagedConfigKey = keyof ManagedConfigValues;
export type SettingMutability = "runtime" | "restart_required";
export type SettingAutonomy = "auto_apply_allowed" | "approval_required";

export interface ManagedConfigDefinition<T> {
  defaultValue: T;
  parse(value: unknown): T;
  redact: boolean;
  mutability: SettingMutability;
  autonomy: SettingAutonomy;
  summary: string;
  behavior: string;
}

export interface ManagedConfigValues {
  COPILOT_MODEL: string;
  MODEL_SHORTLIST: string[];
  RESEARCH_WORKER_MODEL: string;
  NEO_LOG_LEVEL: LogLevel;
  NEO_SKILL_DIRS: string[];
  NEO_CONTEXT_COMPACTION_ENABLED: boolean;
  NEO_CONTEXT_COMPACTION_THRESHOLD: number;
  NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD: number;
}

export interface BrowserCredential {
  username: string;
  password: string;
}

function requiredString(name: string, raw: string | undefined) {
  if (!raw?.trim()) throw new Error(`${name} is required`);
  return raw.trim();
}

function optionalString(raw: string | undefined) {
  return raw?.trim() || undefined;
}

function optionalBoolean(raw: string | undefined, fallback: boolean) {
  if (!raw?.trim()) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Expected boolean value but got "${raw}"`);
}

function positiveInteger(name: string, raw: string | undefined) {
  if (!raw?.trim()) throw new Error(`${name} is required`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parseString(name: string, value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function parseLogLevel(value: unknown) {
  if (typeof value !== "string" || !LOG_LEVELS.includes(value as LogLevel)) {
    throw new Error(`NEO_LOG_LEVEL must be one of: ${LOG_LEVELS.join(", ")}`);
  }
  return value as LogLevel;
}

function parseBoolean(name: string, value: unknown) {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
}

function parseNumberRange(name: string, value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function parseStringArray(name: string, value: unknown) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${name} must be an array of non-empty strings`);
  }
  return value.map((item) => resolve(item));
}

function parseModelShortlist(value: unknown) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("MODEL_SHORTLIST must be an array of non-empty strings");
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    const trimmed = item.trim();
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

export function parseBrowserCredentials(
  raw: string | undefined,
): Record<string, BrowserCredential> {
  if (!raw?.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`NEO_BROWSER_CREDENTIALS_JSON must be valid JSON: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("NEO_BROWSER_CREDENTIALS_JSON must be a JSON object");
  }

  const credentials: Record<string, BrowserCredential> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Credential "${key}" must be an object with username and password`);
    }

    const username = (value as Record<string, unknown>).username;
    const password = (value as Record<string, unknown>).password;
    if (typeof username !== "string" || !username.trim()) {
      throw new Error(`Credential "${key}" username must be a non-empty string`);
    }
    if (typeof password !== "string" || !password.trim()) {
      throw new Error(`Credential "${key}" password must be a non-empty string`);
    }

    credentials[key] = {
      username: username.trim(),
      password,
    };
  }

  return credentials;
}

function defaultSkillDirectories() {
  return DEFAULT_SKILL_DIRS.filter(
    (dir, index, dirs) => existsSync(dir) && dirs.indexOf(dir) === index,
  );
}

function parseOptionalProviderType(raw: string | undefined): "openai" | "anthropic" | undefined {
  const trimmed = raw?.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "openai" || trimmed === "anthropic") return trimmed;
  throw new Error(`NEO_PROVIDER_TYPE must be "openai" or "anthropic", got "${raw}"`);
}

function detectSystemctlScope(): "system" | "user" {
  const configuredScope = process.env.NEO_SYSTEMCTL_SCOPE?.trim();
  if (configuredScope === "user" || configuredScope === "system") {
    return configuredScope;
  }

  const invocationId = process.env.INVOCATION_ID?.trim();
  const runtimeDir = process.env.XDG_RUNTIME_DIR?.trim();
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;

  if (
    invocationId &&
    runtimeDir &&
    uid !== undefined &&
    resolve(runtimeDir) === `/run/user/${uid}`
  ) {
    return "user";
  }

  return "system";
}

export const managedConfigDefinitions: Record<
  ManagedConfigKey,
  ManagedConfigDefinition<unknown>
> = {
  COPILOT_MODEL: {
    defaultValue: "gpt-4.1",
    parse: (value: unknown) => parseString("COPILOT_MODEL", value),
    redact: false,
    mutability: "runtime",
    autonomy: "auto_apply_allowed",
    summary: "Default model",
    behavior: "Sets Neo's default model for chats that are not using a session-specific override.",
  },
  MODEL_SHORTLIST: {
    defaultValue: [] as string[],
    parse: parseModelShortlist,
    redact: false,
    mutability: "runtime",
    autonomy: "auto_apply_allowed",
    summary: "Model shortlist",
    behavior:
      "Stores Neo's ordered global shortlist of preferred models. The first entry is primary and later entries are fallback candidates.",
  },
  RESEARCH_WORKER_MODEL: {
    defaultValue: "claude-sonnet-4.6",
    parse: (value: unknown) => parseString("RESEARCH_WORKER_MODEL", value),
    redact: false,
    mutability: "runtime",
    autonomy: "auto_apply_allowed",
    summary: "Research worker model",
    behavior:
      "Sets the default model for research worker subagents spawned by the /research command. Supports provider:model format.",
  },
  NEO_LOG_LEVEL: {
    defaultValue: "info" as LogLevel,
    parse: parseLogLevel,
    redact: false,
    mutability: "runtime",
    autonomy: "auto_apply_allowed",
    summary: "Neo log level",
    behavior: "Controls Neo log verbosity for stdout and file logs.",
  },
  NEO_SKILL_DIRS: {
    defaultValue: defaultSkillDirectories(),
    parse: (value: unknown) => parseStringArray("NEO_SKILL_DIRS", value),
    redact: false,
    mutability: "restart_required",
    autonomy: "approval_required",
    summary: "Extra skill directories",
    behavior: "Adds extra skill search paths for the Copilot runtime.",
  },
  NEO_CONTEXT_COMPACTION_ENABLED: {
    defaultValue: true,
    parse: (value: unknown) => parseBoolean("NEO_CONTEXT_COMPACTION_ENABLED", value),
    redact: false,
    mutability: "restart_required",
    autonomy: "auto_apply_allowed",
    summary: "Context compaction enabled",
    behavior: "Enables session compaction before context exhaustion after restart.",
  },
  NEO_CONTEXT_COMPACTION_THRESHOLD: {
    defaultValue: 0.8,
    parse: (value: unknown) => parseNumberRange("NEO_CONTEXT_COMPACTION_THRESHOLD", value, 0, 1),
    redact: false,
    mutability: "restart_required",
    autonomy: "auto_apply_allowed",
    summary: "Compaction threshold",
    behavior: "Controls when background context compaction starts after restart.",
  },
  NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD: {
    defaultValue: 0.95,
    parse: (value: unknown) =>
      parseNumberRange("NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD", value, 0, 1),
    redact: false,
    mutability: "restart_required",
    autonomy: "auto_apply_allowed",
    summary: "Buffer exhaustion threshold",
    behavior: "Controls when Neo treats the context buffer as near exhaustion after restart.",
  },
};

export interface Config {
  telegram: {
    botToken: string;
    ownerId: number;
  };
  github: {
    token: string;
  };
  deepgram: {
    apiKey: string | undefined;
  };
  copilot: {
    model: string;
    modelShortlist: string[];
    researchWorkerModel: string;
    skillDirectories: string[];
    contextCompaction: {
      enabled: boolean;
      threshold: number;
      bufferExhaustionThreshold: number;
    };
  };
  browser: {
    defaultHeadless: boolean;
    launchArgs: string[];
    credentials: Record<string, BrowserCredential>;
  };
  paths: {
    root: string;
    data: string;
    logs: string;
    soul: string;
    preferences: string;
    human: string;
    memoryDir: string;
    runtimeState: string;
    changeHistory: string;
    restartHistory: string;
    managedConfigFile: string;
    managedConfigBackupDir: string;
    browserData: string;
    browserSessions: string;
    browserScreenshots: string;
    browserDownloads: string;
    researchDir: string;
  };
  logging: {
    level: LogLevel;
  };
  providers: {
    anthropicApiKey: string | undefined;
    openaiApiKey: string | undefined;
    vercelAiGatewayApiKey: string | undefined;
    custom: {
      name: string | undefined;
      type: "openai" | "anthropic" | undefined;
      baseUrl: string | undefined;
      apiKey: string | undefined;
      bearerToken: string | undefined;
    };
  };
  service: {
    systemdUnit: string;
    systemctlScope: "system" | "user";
  };
}

export function defaultManagedConfig(): ManagedConfigValues {
  return {
    COPILOT_MODEL: managedConfigDefinitions.COPILOT_MODEL.defaultValue as string,
    MODEL_SHORTLIST: managedConfigDefinitions.MODEL_SHORTLIST.defaultValue as string[],
    RESEARCH_WORKER_MODEL: managedConfigDefinitions.RESEARCH_WORKER_MODEL.defaultValue as string,
    NEO_LOG_LEVEL: managedConfigDefinitions.NEO_LOG_LEVEL.defaultValue as LogLevel,
    NEO_SKILL_DIRS: managedConfigDefinitions.NEO_SKILL_DIRS.defaultValue as string[],
    NEO_CONTEXT_COMPACTION_ENABLED: managedConfigDefinitions.NEO_CONTEXT_COMPACTION_ENABLED
      .defaultValue as boolean,
    NEO_CONTEXT_COMPACTION_THRESHOLD: managedConfigDefinitions.NEO_CONTEXT_COMPACTION_THRESHOLD
      .defaultValue as number,
    NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD: managedConfigDefinitions
      .NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD.defaultValue as number,
  };
}

function parseManagedConfigFile(input: unknown): ManagedConfigValues {
  const source =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const errors: string[] = [];
  const defaults = defaultManagedConfig();
  const parsed = {} as ManagedConfigValues;

  for (const key of Object.keys(managedConfigDefinitions) as ManagedConfigKey[]) {
    const definition = managedConfigDefinitions[key];
    const candidate = source[key] ?? definition.defaultValue;
    try {
      parsed[key] = definition.parse(candidate) as never;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`  - ${key}: ${message}`);
      parsed[key] = defaults[key] as never;
    }
  }

  if (errors.length > 0) {
    throw new Error(`❌ Managed config error:\n${errors.join("\n")}`);
  }

  return parsed;
}

function readJsonFile(path: string) {
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as unknown;
}

function configBackupDir(path: string) {
  return join(dirname(path), "config-backups");
}

function configBackupPath(
  path: string,
  kind: "pre" | "snapshot" = "snapshot",
  timestamp = new Date().toISOString(),
) {
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  return join(configBackupDir(path), `config.${safeTimestamp}.${kind}.json`);
}

function backupManagedConfigFile(path: string) {
  if (!existsSync(path)) return null;
  const backupDir = configBackupDir(path);
  mkdirSync(backupDir, { recursive: true });
  const backupPath = configBackupPath(path, "pre");
  copyFileSync(path, backupPath);
  return backupPath;
}

function snapshotManagedConfigFile(path: string) {
  if (!existsSync(path)) return null;
  const backupDir = configBackupDir(path);
  mkdirSync(backupDir, { recursive: true });
  const backupPath = configBackupPath(path, "snapshot");
  copyFileSync(path, backupPath);
  return backupPath;
}

function moveBrokenManagedConfigFile(path: string) {
  if (!existsSync(path)) return null;
  const backupDir = configBackupDir(path);
  mkdirSync(backupDir, { recursive: true });
  const brokenPath = join(
    backupDir,
    `config.broken.${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  renameSync(path, brokenPath);
  return brokenPath;
}

function listBackupFiles(path: string) {
  const backupDir = configBackupDir(path);
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((name) => /^config\..*\.(pre|snapshot)\.json$/.test(name) && !name.includes(".broken."))
    .sort()
    .reverse()
    .map((name) => join(backupDir, name));
}

function restoreNewestValidBackup(path: string) {
  for (const backupPath of listBackupFiles(path)) {
    try {
      const parsed = parseManagedConfigFile(readJsonFile(backupPath));
      writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
      return {
        restoredFrom: backupPath,
        values: parsed,
      };
    } catch {
      continue;
    }
  }

  return null;
}

export function loadManagedConfigFile(path: string): ManagedConfigValues {
  try {
    const parsed = parseManagedConfigFile(readJsonFile(path));
    return parsed;
  } catch (error) {
    mkdirSync(dirname(path), { recursive: true });
    const missingFile =
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT";

    if (missingFile) {
      const defaults = defaultManagedConfig();
      writeFileSync(path, `${JSON.stringify(defaults, null, 2)}\n`, "utf-8");
      return defaults;
    }

    const brokenPath = moveBrokenManagedConfigFile(path);
    const restored = restoreNewestValidBackup(path);
    if (restored) {
      return restored.values;
    }

    const defaults = defaultManagedConfig();
    writeFileSync(path, `${JSON.stringify(defaults, null, 2)}\n`, "utf-8");
    if (brokenPath) {
      console.warn(
        `Managed config was invalid and no valid backup was found. Archived broken config to ${brokenPath} and created a new default config.`,
      );
    }
    return defaults;
  }
}

export function writeManagedConfigFile(path: string, values: ManagedConfigValues) {
  mkdirSync(dirname(path), { recursive: true });
  backupManagedConfigFile(path);
  writeFileSync(path, `${JSON.stringify(values, null, 2)}\n`, "utf-8");
  snapshotManagedConfigFile(path);
}

export async function ensureDataDir(): Promise<{ isFirstRun: boolean }> {
  const soulPath = join(DEFAULT_DATA_DIR, "SOUL.md");
  const isFirstRun = !existsSync(soulPath);

  await mkdir(DEFAULT_DATA_DIR, { recursive: true });
  await mkdir(join(DEFAULT_DATA_DIR, "memory"), { recursive: true });
  await mkdir(join(DEFAULT_DATA_DIR, "browser", "sessions"), { recursive: true });
  await mkdir(join(DEFAULT_DATA_DIR, "browser", "screenshots"), { recursive: true });
  await mkdir(join(DEFAULT_DATA_DIR, "browser", "downloads"), { recursive: true });
  await mkdir(join(DEFAULT_DATA_DIR, "research"), { recursive: true });

  if (isFirstRun) {
    await writeFile(soulPath, "# Soul\n\nYou are Neo, a personal AI agent.\n", "utf-8");
    await writeFile(join(DEFAULT_DATA_DIR, "HUMAN.md"), "# Human\n", "utf-8");
    await writeFile(join(DEFAULT_DATA_DIR, "PREFERENCES.md"), "# Preferences\n", "utf-8");
  }

  return { isFirstRun };
}

function loadConfig(): Config {
  try {
    const dataDir = DEFAULT_DATA_DIR;
    const logDir = DEFAULT_LOG_DIR;
    const managedConfigFile = join(dataDir, "config.json");
    const managed = loadManagedConfigFile(managedConfigFile);

    return {
      telegram: {
        botToken: requiredString("TELEGRAM_BOT_TOKEN", process.env.TELEGRAM_BOT_TOKEN),
        ownerId: positiveInteger("TELEGRAM_OWNER_ID", process.env.TELEGRAM_OWNER_ID),
      },
      github: {
        token: requiredString("GITHUB_TOKEN", process.env.GITHUB_TOKEN),
      },
      deepgram: {
        apiKey: optionalString(process.env.DEEPGRAM_API_KEY),
      },
      copilot: {
        model: managed.COPILOT_MODEL,
        modelShortlist: managed.MODEL_SHORTLIST,
        researchWorkerModel: managed.RESEARCH_WORKER_MODEL,
        skillDirectories: managed.NEO_SKILL_DIRS,
        contextCompaction: {
          enabled: managed.NEO_CONTEXT_COMPACTION_ENABLED,
          threshold: managed.NEO_CONTEXT_COMPACTION_THRESHOLD,
          bufferExhaustionThreshold: managed.NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD,
        },
      },
      providers: {
        anthropicApiKey: optionalString(process.env.ANTHROPIC_API_KEY),
        openaiApiKey: optionalString(process.env.OPENAI_API_KEY),
        vercelAiGatewayApiKey: optionalString(process.env.AI_GATEWAY_API_KEY),
        custom: {
          name: optionalString(process.env.NEO_PROVIDER_NAME),
          type: parseOptionalProviderType(process.env.NEO_PROVIDER_TYPE),
          baseUrl: optionalString(process.env.NEO_PROVIDER_BASE_URL),
          apiKey: optionalString(process.env.NEO_PROVIDER_API_KEY),
          bearerToken: optionalString(process.env.NEO_PROVIDER_BEARER_TOKEN),
        },
      },
      browser: {
        defaultHeadless: optionalBoolean(process.env.NEO_BROWSER_HEADLESS, true),
        launchArgs: (process.env.NEO_BROWSER_LAUNCH_ARGS || "")
          .split(/\s+/)
          .map((arg) => arg.trim())
          .filter(Boolean),
        credentials: parseBrowserCredentials(process.env.NEO_BROWSER_CREDENTIALS_JSON),
      },
      paths: {
        root: PROJECT_ROOT,
        data: dataDir,
        logs: logDir,
        soul: join(dataDir, "SOUL.md"),
        preferences: join(dataDir, "PREFERENCES.md"),
        human: join(dataDir, "HUMAN.md"),
        memoryDir: join(dataDir, "memory"),
        runtimeState: join(dataDir, "runtime-state.json"),
        changeHistory: join(dataDir, "config-history.jsonl"),
        restartHistory: join(dataDir, "restart-history.jsonl"),
        managedConfigFile,
        managedConfigBackupDir: configBackupDir(managedConfigFile),
        browserData: join(dataDir, "browser"),
        browserSessions: join(dataDir, "browser", "sessions"),
        browserScreenshots: join(dataDir, "browser", "screenshots"),
        browserDownloads: join(dataDir, "browser", "downloads"),
        researchDir: join(dataDir, "research"),
      },
      logging: {
        level: managed.NEO_LOG_LEVEL,
      },
      service: {
        systemdUnit: process.env.NEO_SYSTEMD_UNIT?.trim() || "neo",
        systemctlScope: detectSystemctlScope(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

export function isManagedConfigKey(value: string): value is ManagedConfigKey {
  return value in managedConfigDefinitions;
}

export function getManagedConfigDefinition(key: ManagedConfigKey) {
  return managedConfigDefinitions[key];
}

export function redactSettingValue(key: ManagedConfigKey, value: unknown): unknown {
  return managedConfigDefinitions[key].redact ? "[REDACTED]" : value;
}

export const config = loadConfig();

export function hasAnyProvider(): boolean {
  return !!(
    config.providers.anthropicApiKey ||
    config.providers.openaiApiKey ||
    config.providers.vercelAiGatewayApiKey ||
    config.providers.custom.baseUrl
  );
}
