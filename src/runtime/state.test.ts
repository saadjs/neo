import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { switchDefaultModelMock, getLogLevelMock, setLogLevelMock, execFileMock } = vi.hoisted(
  () => ({
    switchDefaultModelMock: vi.fn(),
    getLogLevelMock: vi.fn(() => "info"),
    setLogLevelMock: vi.fn(),
    execFileMock: vi.fn(),
  }),
);

let dataDir = "";
let tempDirs: string[] = [];

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("../config.js", () => ({
  config: {
    copilot: {
      model: "gpt-4.1",
      skillDirectories: [],
      contextCompaction: {
        enabled: true,
        threshold: 0.8,
        bufferExhaustionThreshold: 0.95,
      },
    },
    logging: {
      level: "info",
    },
    paths: {
      get data() {
        return dataDir;
      },
      get runtimeState() {
        return join(dataDir, "runtime-state.json");
      },
      get changeHistory() {
        return join(dataDir, "config-history.jsonl");
      },
      get restartHistory() {
        return join(dataDir, "restart-history.jsonl");
      },
      get managedConfigFile() {
        return join(dataDir, "config.json");
      },
    },
    service: {
      systemdUnit: "neo",
      systemctlScope: "system",
    },
  },
  defaultManagedConfig: () => ({
    COPILOT_MODEL: "gpt-4.1",
    MODEL_SHORTLIST: [],
    NEO_LOG_LEVEL: "info",
    NEO_SKILL_DIRS: [],
    NEO_CONTEXT_COMPACTION_ENABLED: true,
    NEO_CONTEXT_COMPACTION_THRESHOLD: 0.8,
    NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD: 0.95,
  }),
  getManagedConfigDefinition: (key: string) => ({
    parse: (value: unknown) => value,
    mutability:
      key === "COPILOT_MODEL" || key === "MODEL_SHORTLIST" || key === "NEO_LOG_LEVEL"
        ? "runtime"
        : "restart_required",
    autonomy: key === "NEO_SKILL_DIRS" ? "approval_required" : "auto_apply_allowed",
    summary: key,
    behavior: key,
    redact: false,
  }),
  isManagedConfigKey: (value: string) =>
    [
      "COPILOT_MODEL",
      "MODEL_SHORTLIST",
      "NEO_LOG_LEVEL",
      "NEO_SKILL_DIRS",
      "NEO_CONTEXT_COMPACTION_ENABLED",
      "NEO_CONTEXT_COMPACTION_THRESHOLD",
      "NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD",
    ].includes(value),
  loadManagedConfigFile: () => ({
    COPILOT_MODEL: "gpt-4.1",
    MODEL_SHORTLIST: [],
    NEO_LOG_LEVEL: "info",
    NEO_SKILL_DIRS: [],
    NEO_CONTEXT_COMPACTION_ENABLED: true,
    NEO_CONTEXT_COMPACTION_THRESHOLD: 0.8,
    NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD: 0.95,
  }),
  redactSettingValue: (_key: string, value: unknown) => value,
  writeManagedConfigFile: vi.fn(),
}));

vi.mock("../agent.js", () => ({
  switchDefaultModel: switchDefaultModelMock,
}));

vi.mock("../logging/index.js", () => ({
  getLogLevel: getLogLevelMock,
  setLogLevel: setLogLevelMock,
  getLogger: () => ({
    info: vi.fn(),
  }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.clearAllMocks();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("restartService", () => {
  it("records a process-exit restart and exits without calling systemctl", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "neo-runtime-state-test-"));
    tempDirs.push(dataDir);
    vi.useFakeTimers();

    const exitMock = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    const { restartService } = await import("./state");

    await expect(
      restartService({
        actor: "test",
        source: "command",
        reason: "test restart",
        chatId: 123,
      }),
    ).resolves.toEqual({
      message: "Restart requested for neo; exiting for supervisor restart.",
      mode: "process-exit",
    });

    expect(execFileMock).not.toHaveBeenCalledWith(
      "systemctl",
      expect.anything(),
      expect.anything(),
    );

    const marker = JSON.parse(readFileSync(join(dataDir, ".restart-marker"), "utf-8")) as {
      reason: string;
      chatId: number;
    };
    expect(marker.reason).toBe("test restart");
    expect(marker.chatId).toBe(123);

    const history = readFileSync(join(dataDir, "restart-history.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { mode: string; status: string; reason: string })
      .map(({ mode, reason, status }) => ({ mode, reason, status }));
    expect(history).toEqual([
      {
        mode: "process-exit",
        reason: "test restart",
        status: "requested",
      },
    ]);

    await vi.advanceTimersByTimeAsync(250);
    expect(exitMock).toHaveBeenCalledWith(0);
  });
});
