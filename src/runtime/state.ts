import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  config,
  defaultManagedConfig,
  getManagedConfigDefinition,
  isManagedConfigKey,
  loadManagedConfigFile,
  redactSettingValue,
  type ManagedConfigKey,
  type ManagedConfigValues,
  writeManagedConfigFile,
} from "../config";
import { switchDefaultModel } from "../agent";
import { getLogLevel, getLogger, setLogLevel } from "../logging/index";
import { GIT_COMMIT, GIT_COMMIT_DATE } from "../version";

const execFileAsync = promisify(execFile);
const RESTART_MARKER_FILE = ".restart-marker";
const MAX_HISTORY_ITEMS = 20;

export interface ConfigChangeRecord {
  timestamp: string;
  actor: string;
  key: ManagedConfigKey;
  before: unknown;
  after: unknown;
  source: "tool" | "command" | "startup";
  reason: string;
  mutability: string;
  autonomy: string;
  restartRequired: boolean;
  status: "planned" | "applied" | "rejected";
}

export interface RestartRecord {
  timestamp: string;
  actor: string;
  source: "tool" | "command" | "startup";
  reason: string;
  chatId?: number;
  mode: "process-exit" | "startup-detected";
  status: "requested" | "completed";
  detail?: string;
}

export interface RestartMarker {
  timestamp: string;
  actor: string;
  source: "tool" | "command" | "startup";
  reason: string;
  chatId?: number;
  changes?: Array<{
    key: ManagedConfigKey;
    before: unknown;
    after: unknown;
  }>;
}

interface RuntimeStateData {
  deploymentMode: "systemd";
  systemdAvailable: boolean;
  systemdActiveState: string;
  managedConfigPath: string;
  managedConfigExists: boolean;
  serviceUnit: string;
  serviceScope: "system" | "user";
  effectiveConfig: Record<ManagedConfigKey, unknown>;
  fileConfig: Record<ManagedConfigKey, unknown>;
  configSources: Record<ManagedConfigKey, "config_json">;
  mutability: Record<ManagedConfigKey, string>;
  autonomy: Record<ManagedConfigKey, string>;
  lastRestart: RestartMarker | null;
  lastRestartDetectedAt: string | null;
  restartRequired: boolean;
  pendingReasons: string[];
}

let runtimeState: RuntimeStateData | null = null;

function restartMarkerPath() {
  return join(config.paths.data, RESTART_MARKER_FILE);
}

async function appendJsonLine(path: string, payload: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(payload)}\n`, "utf-8");
}

async function readJsonLines<T>(path: string, limit = MAX_HISTORY_ITEMS): Promise<T[]> {
  try {
    const raw = await readFile(path, "utf-8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

async function detectSystemdState() {
  const args =
    config.service.systemctlScope === "user"
      ? ["--user", "is-active", config.service.systemdUnit]
      : ["is-active", config.service.systemdUnit];

  try {
    const result = await execFileAsync("systemctl", args);
    return {
      available: true,
      activeState: (result.stdout || "").trim() || "unknown",
    };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout?.trim();
    const stderr = (error as { stderr?: string }).stderr?.trim();
    const code = (error as NodeJS.ErrnoException).code;
    const detail = stdout || stderr || "unavailable";
    return {
      available: code !== "ENOENT",
      activeState: detail,
    };
  }
}

function getManagedValuesSnapshot(): ManagedConfigValues {
  return {
    COPILOT_MODEL: config.copilot.model,
    NEO_LOG_LEVEL: getLogLevel(),
    NEO_SKILL_DIRS: config.copilot.skillDirectories,
    NEO_CONTEXT_COMPACTION_ENABLED: config.copilot.contextCompaction.enabled,
    NEO_CONTEXT_COMPACTION_THRESHOLD: config.copilot.contextCompaction.threshold,
    NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD:
      config.copilot.contextCompaction.bufferExhaustionThreshold,
  };
}

async function applyRuntimeValue(key: ManagedConfigKey, value: unknown) {
  switch (key) {
    case "COPILOT_MODEL":
      await switchDefaultModel(String(value));
      break;
    case "NEO_LOG_LEVEL":
      config.logging.level = String(value) as typeof config.logging.level;
      setLogLevel(config.logging.level);
      break;
    case "NEO_SKILL_DIRS":
      config.copilot.skillDirectories = value as string[];
      break;
    case "NEO_CONTEXT_COMPACTION_ENABLED":
      config.copilot.contextCompaction.enabled = Boolean(value);
      break;
    case "NEO_CONTEXT_COMPACTION_THRESHOLD":
      config.copilot.contextCompaction.threshold = Number(value);
      break;
    case "NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD":
      config.copilot.contextCompaction.bufferExhaustionThreshold = Number(value);
      break;
  }
}

async function writeRuntimeStateFile() {
  if (!runtimeState) return;
  await mkdir(dirname(config.paths.runtimeState), { recursive: true });
  await writeFile(config.paths.runtimeState, JSON.stringify(runtimeState, null, 2), "utf-8");
}

async function readRestartMarkerFile(): Promise<RestartMarker | null> {
  try {
    const raw = await readFile(restartMarkerPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<RestartMarker>;
    if (typeof parsed.timestamp === "string" && typeof parsed.reason === "string") {
      return {
        timestamp: parsed.timestamp,
        actor: parsed.actor ?? "unknown",
        source: parsed.source ?? "startup",
        reason: parsed.reason,
        chatId: parsed.chatId,
        changes: parsed.changes,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function consumeRestartMarker(): Promise<RestartMarker | null> {
  const marker = await readRestartMarkerFile();
  if (!marker) return null;
  try {
    await unlink(restartMarkerPath());
  } catch {}
  return marker;
}

async function persistRestartMarker(marker: RestartMarker) {
  await mkdir(config.paths.data, { recursive: true });
  await writeFile(restartMarkerPath(), JSON.stringify(marker, null, 2), "utf-8");
}

async function rebuildRuntimeState(lastRestart: RestartMarker | null): Promise<RuntimeStateData> {
  const systemd = await detectSystemdState();
  const effectiveConfig = getManagedValuesSnapshot();
  const fileConfig = loadManagedConfigFile(config.paths.managedConfigFile);
  const mutability = {} as Record<ManagedConfigKey, string>;
  const autonomy = {} as Record<ManagedConfigKey, string>;
  const configSources = {} as Record<ManagedConfigKey, "config_json">;
  const pendingReasons: string[] = [];
  let restartRequired = false;

  for (const key of Object.keys(defaultManagedConfig()) as ManagedConfigKey[]) {
    const definition = getManagedConfigDefinition(key);
    mutability[key] = definition.mutability;
    autonomy[key] = definition.autonomy;
    configSources[key] = "config_json";

    if (definition.mutability !== "restart_required") continue;

    const liveValue = effectiveConfig[key];
    const persistedValue = fileConfig[key];
    if (JSON.stringify(liveValue) !== JSON.stringify(persistedValue)) {
      restartRequired = true;
      pendingReasons.push(`${key} differs between live runtime and config.json.`);
    }
  }

  return {
    deploymentMode: "systemd",
    systemdAvailable: systemd.available,
    systemdActiveState: systemd.activeState,
    managedConfigPath: config.paths.managedConfigFile,
    managedConfigExists: true,
    serviceUnit: config.service.systemdUnit,
    serviceScope: config.service.systemctlScope,
    effectiveConfig,
    fileConfig,
    configSources,
    mutability,
    autonomy,
    lastRestart,
    lastRestartDetectedAt: lastRestart?.timestamp ?? null,
    restartRequired,
    pendingReasons,
  };
}

export async function initializeRuntimeState(lastRestart: RestartMarker | null) {
  runtimeState = await rebuildRuntimeState(lastRestart);
  await writeRuntimeStateFile();
}

async function refreshRuntimeState() {
  runtimeState = await rebuildRuntimeState(runtimeState?.lastRestart ?? null);
  await writeRuntimeStateFile();
  return runtimeState;
}

export function getRuntimeState() {
  if (!runtimeState) throw new Error("Runtime state not initialized");
  return runtimeState;
}

function normalizeInputValue(key: ManagedConfigKey, value: string) {
  switch (key) {
    case "COPILOT_MODEL":
    case "NEO_LOG_LEVEL":
      return getManagedConfigDefinition(key).parse(value);
    case "NEO_SKILL_DIRS":
      return getManagedConfigDefinition(key).parse(JSON.parse(value));
    case "NEO_CONTEXT_COMPACTION_ENABLED":
      return getManagedConfigDefinition(key).parse(value === "true");
    case "NEO_CONTEXT_COMPACTION_THRESHOLD":
    case "NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD":
      return getManagedConfigDefinition(key).parse(Number(value));
  }
}

function persistManagedValues(values: ManagedConfigValues) {
  writeManagedConfigFile(config.paths.managedConfigFile, values);
}

export async function planConfigChange(params: {
  key: ManagedConfigKey;
  value: string;
  actor: string;
  source: ConfigChangeRecord["source"];
  reason: string;
}) {
  const definition = getManagedConfigDefinition(params.key);
  const parsed = normalizeInputValue(params.key, params.value);
  const before = getManagedValuesSnapshot()[params.key];
  const changed = JSON.stringify(before) !== JSON.stringify(parsed);

  const record: ConfigChangeRecord = {
    timestamp: new Date().toISOString(),
    actor: params.actor,
    key: params.key,
    before: redactSettingValue(params.key, before),
    after: redactSettingValue(params.key, parsed),
    source: params.source,
    reason: params.reason,
    mutability: definition.mutability,
    autonomy: definition.autonomy,
    restartRequired: definition.mutability === "restart_required",
    status: changed ? "planned" : "rejected",
  };
  await appendJsonLine(config.paths.changeHistory, record);

  return {
    key: params.key,
    summary: definition.summary,
    behavior: definition.behavior,
    before: redactSettingValue(params.key, before),
    after: redactSettingValue(params.key, parsed),
    changed,
    mutability: definition.mutability,
    autonomy: definition.autonomy,
    restartRequired: definition.mutability === "restart_required",
    autoApplyAllowed: definition.autonomy === "auto_apply_allowed",
  };
}

export async function applyConfigChange(params: {
  key: ManagedConfigKey;
  value: string;
  actor: string;
  source: ConfigChangeRecord["source"];
  reason: string;
  allowApprovalRequired?: boolean;
}) {
  const definition = getManagedConfigDefinition(params.key);
  const parsed = normalizeInputValue(params.key, params.value);
  const before = getManagedValuesSnapshot()[params.key];

  if (definition.autonomy === "approval_required" && !params.allowApprovalRequired) {
    await appendJsonLine(config.paths.changeHistory, {
      timestamp: new Date().toISOString(),
      actor: params.actor,
      key: params.key,
      before: redactSettingValue(params.key, before),
      after: redactSettingValue(params.key, parsed),
      source: params.source,
      reason: params.reason,
      mutability: definition.mutability,
      autonomy: definition.autonomy,
      restartRequired: definition.mutability === "restart_required",
      status: "rejected",
    } satisfies ConfigChangeRecord);

    return {
      applied: false,
      reason: `${params.key} requires approval and is outside the auto-apply allowlist.`,
      restartTriggered: false,
    };
  }

  const nextValues = getManagedValuesSnapshot();
  nextValues[params.key] = parsed as never;
  persistManagedValues(nextValues);

  if (definition.mutability === "runtime") {
    await applyRuntimeValue(params.key, parsed);
  }

  await appendJsonLine(config.paths.changeHistory, {
    timestamp: new Date().toISOString(),
    actor: params.actor,
    key: params.key,
    before: redactSettingValue(params.key, before),
    after: redactSettingValue(params.key, parsed),
    source: params.source,
    reason: params.reason,
    mutability: definition.mutability,
    autonomy: definition.autonomy,
    restartRequired: definition.mutability === "restart_required",
    status: "applied",
  } satisfies ConfigChangeRecord);

  await refreshRuntimeState();

  if (definition.mutability === "restart_required") {
    const restart = await restartService({
      actor: params.actor,
      source: params.source,
      reason: `Applied ${params.key}: ${params.reason}`,
      changes: [{ key: params.key, before, after: parsed }],
    });
    return {
      applied: true,
      reason: `${params.key} updated and restart requested.`,
      restartTriggered: true,
      restart,
    };
  }

  return {
    applied: true,
    reason: `${params.key} updated without restart.`,
    restartTriggered: false,
  };
}

export async function restartService(params: {
  actor: string;
  source: RestartRecord["source"];
  reason: string;
  chatId?: number;
  changes?: RestartMarker["changes"];
}) {
  const marker: RestartMarker = {
    timestamp: new Date().toISOString(),
    actor: params.actor,
    source: params.source,
    reason: params.reason,
    chatId: params.chatId,
    changes: params.changes,
  };

  await persistRestartMarker(marker);
  await appendJsonLine(config.paths.restartHistory, {
    timestamp: marker.timestamp,
    actor: params.actor,
    source: params.source,
    reason: params.reason,
    chatId: params.chatId,
    mode: "process-exit",
    status: "requested",
  } satisfies RestartRecord);

  setTimeout(() => process.exit(0), 250);
  return {
    message: `Restart requested for ${config.service.systemdUnit}; exiting for supervisor restart.`,
    mode: "process-exit" as const,
  };
}

export async function noteStartupRestart(marker: RestartMarker | null) {
  if (!marker) return;
  await appendJsonLine(config.paths.restartHistory, {
    timestamp: new Date().toISOString(),
    actor: marker.actor,
    source: "startup",
    reason: marker.reason,
    chatId: marker.chatId,
    mode: "startup-detected",
    status: "completed",
  } satisfies RestartRecord);
}

export function getRuntimeContextSection() {
  if (!runtimeState) return "";
  const lines = [
    "## Neo Runtime State",
    "",
    `Deployment mode: ${runtimeState.deploymentMode}`,
    `Service: ${runtimeState.serviceUnit} (${runtimeState.systemdActiveState})`,
    `Managed config: ${runtimeState.managedConfigPath}`,
    `Restart required: ${runtimeState.restartRequired ? "yes" : "no"}`,
  ];

  if (runtimeState.lastRestart) {
    lines.push(
      `Last restart: ${runtimeState.lastRestart.timestamp} (${runtimeState.lastRestart.reason})`,
    );
  }

  lines.push(
    "",
    "Selected settings:",
    `- COPILOT_MODEL=${String(runtimeState.effectiveConfig.COPILOT_MODEL)}`,
    `- NEO_LOG_LEVEL=${String(runtimeState.effectiveConfig.NEO_LOG_LEVEL)}`,
    `- NEO_CONTEXT_COMPACTION_ENABLED=${String(runtimeState.effectiveConfig.NEO_CONTEXT_COMPACTION_ENABLED)}`,
    `- NEO_CONTEXT_COMPACTION_THRESHOLD=${String(runtimeState.effectiveConfig.NEO_CONTEXT_COMPACTION_THRESHOLD)}`,
    `- NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD=${String(runtimeState.effectiveConfig.NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD)}`,
  );

  return lines.join("\n");
}

export async function getRecentChanges() {
  return readJsonLines<ConfigChangeRecord>(config.paths.changeHistory);
}

export async function getRecentRestarts() {
  return readJsonLines<RestartRecord>(config.paths.restartHistory);
}

export async function explainSetting(key: ManagedConfigKey) {
  const state = getRuntimeState();
  const definition = getManagedConfigDefinition(key);
  return {
    key,
    summary: definition.summary,
    behavior: definition.behavior,
    currentValue: state.effectiveConfig[key],
    source: state.configSources[key],
    mutability: definition.mutability,
    autonomy: definition.autonomy,
    fileValue: state.fileConfig[key],
    restartRequired: definition.mutability === "restart_required",
  };
}

export async function getSystemStatus() {
  const state = await refreshRuntimeState();
  const changes = await getRecentChanges();
  const restarts = await getRecentRestarts();
  return {
    deploymentMode: state.deploymentMode,
    service: {
      unit: state.serviceUnit,
      scope: state.serviceScope,
      activeState: state.systemdActiveState,
      systemdAvailable: state.systemdAvailable,
    },
    managedConfig: {
      path: state.managedConfigPath,
      exists: state.managedConfigExists,
    },
    restart: {
      required: state.restartRequired,
      pendingReasons: state.pendingReasons,
      lastRestart: state.lastRestart,
    },
    effectiveConfig: state.effectiveConfig,
    sources: state.configSources,
    mutability: state.mutability,
    autonomy: state.autonomy,
    recentChanges: changes,
    recentRestarts: restarts,
  };
}

export function formatSystemStatusSummary(status: Awaited<ReturnType<typeof getSystemStatus>>) {
  const formattedDate = GIT_COMMIT_DATE
    ? new Date(GIT_COMMIT_DATE).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "";
  const commitInfo = formattedDate ? `${GIT_COMMIT} (${formattedDate})` : GIT_COMMIT;
  const lines = [
    `Service: ${status.service.unit} (${status.service.activeState})`,
    `Supervisor available: ${status.service.systemdAvailable ? "yes" : "no"}`,
    `Managed config: ${status.managedConfig.path}`,
    `Restart required: ${status.restart.required ? "yes" : "no"}`,
    `Commit: \`${commitInfo}\``,
    `Default model: ${String(status.effectiveConfig.COPILOT_MODEL)}`,
    `Log level: ${String(status.effectiveConfig.NEO_LOG_LEVEL)}`,
  ];

  if (status.restart.lastRestart) {
    lines.push(
      `Last restart: ${status.restart.lastRestart.timestamp} — ${status.restart.lastRestart.reason}`,
    );
  }

  return lines.join("\n");
}

export async function logAutonomyStartup(lastRestart: RestartMarker | null) {
  await initializeRuntimeState(lastRestart);
  await noteStartupRestart(lastRestart);
  const log = getLogger();
  log.info(
    { deployment: getRuntimeState().deploymentMode, service: getRuntimeState().serviceUnit },
    "Runtime state initialized",
  );
}

export { isManagedConfigKey };
