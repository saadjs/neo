import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const REQUIRED_ENV = {
  TELEGRAM_BOT_TOKEN: "token",
  TELEGRAM_OWNER_ID: "123",
  GITHUB_TOKEN: "github-token",
};

const ENV_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_OWNER_ID",
  "GITHUB_TOKEN",
  "DEEPGRAM_API_KEY",
  "NEO_DATA_DIR",
  "NEO_LOG_DIR",
  "NEO_BROWSER_CREDENTIALS_JSON",
  "NEO_BROWSER_HEADLESS",
  "NEO_BROWSER_LAUNCH_ARGS",
  "NEO_SYSTEMD_UNIT",
  "NEO_SYSTEMCTL_SCOPE",
  "INVOCATION_ID",
  "XDG_RUNTIME_DIR",
  "HOME",
] as const;

let tempDirs: string[] = [];

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : 0;
}

describe("parseBrowserCredentials", () => {
  it("preserves leading and trailing password whitespace", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "neo-config-test-"));
    const logDir = mkdtempSync(join(tmpdir(), "neo-config-test-"));
    tempDirs.push(dataDir, logDir);

    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("NEO_DATA_DIR", dataDir);
    vi.stubEnv("NEO_LOG_DIR", logDir);
    vi.stubEnv(
      "NEO_BROWSER_CREDENTIALS_JSON",
      JSON.stringify({
        github: {
          username: " neo@example.com ",
          password: "  secret  ",
        },
      }),
    );

    const { config } = await import("./config");

    expect(config.browser.credentials.github).toEqual({
      username: "neo@example.com",
      password: "  secret  ",
    });
  });

  it("defaults skill directories to an empty list when built-in skill directories are absent", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "neo-config-test-"));
    const logDir = mkdtempSync(join(tmpdir(), "neo-config-test-"));
    const homeDir = mkdtempSync(join(tmpdir(), "neo-home-test-"));
    tempDirs.push(dataDir, logDir, homeDir);

    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("NEO_DATA_DIR", dataDir);
    vi.stubEnv("NEO_LOG_DIR", logDir);
    vi.stubEnv("HOME", homeDir);

    const { config } = await import("./config");

    expect(config.copilot.skillDirectories).toEqual([]);

    const persistedConfig = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf-8")) as {
      NEO_SKILL_DIRS: string[];
    };
    expect(persistedConfig.NEO_SKILL_DIRS).toEqual([]);
  });

  it("includes ~/.agents/skills as a default skill directory when present", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "neo-config-test-"));
    const logDir = mkdtempSync(join(tmpdir(), "neo-config-test-"));
    const homeDir = mkdtempSync(join(tmpdir(), "neo-home-test-"));
    const userSkillsDir = join(homeDir, ".agents", "skills");
    tempDirs.push(dataDir, logDir, homeDir);

    mkdirSync(userSkillsDir, { recursive: true });
    writeFileSync(join(userSkillsDir, ".keep"), "", { encoding: "utf-8", flag: "w" });

    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("NEO_DATA_DIR", dataDir);
    vi.stubEnv("NEO_LOG_DIR", logDir);
    vi.stubEnv("HOME", homeDir);

    const { config } = await import("./config");

    expect(config.copilot.skillDirectories).toEqual([userSkillsDir]);

    const persistedConfig = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf-8")) as {
      NEO_SKILL_DIRS: string[];
    };
    expect(persistedConfig.NEO_SKILL_DIRS).toEqual([userSkillsDir]);
  });

  it("preserves configured skill directories from config.json", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "neo-config-test-"));
    const logDir = mkdtempSync(join(tmpdir(), "neo-config-test-"));
    const skillsDir = mkdtempSync(join(tmpdir(), "neo-skills-test-"));
    tempDirs.push(dataDir, logDir, skillsDir);

    writeFileSync(
      join(dataDir, "config.json"),
      `${JSON.stringify(
        {
          COPILOT_MODEL: "gpt-4.1",
          NEO_LOG_LEVEL: "info",
          NEO_SKILL_DIRS: [skillsDir],
          NEO_CONTEXT_COMPACTION_ENABLED: true,
          NEO_CONTEXT_COMPACTION_THRESHOLD: 0.8,
          NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD: 0.95,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("NEO_DATA_DIR", dataDir);
    vi.stubEnv("NEO_LOG_DIR", logDir);

    const { config } = await import("./config");

    expect(config.copilot.skillDirectories).toEqual([skillsDir]);
  });

  it("auto-detects user systemd scope when launched by the user manager", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "neo-config-test-"));
    const logDir = mkdtempSync(join(tmpdir(), "neo-config-test-"));
    tempDirs.push(dataDir, logDir);

    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("NEO_DATA_DIR", dataDir);
    vi.stubEnv("NEO_LOG_DIR", logDir);
    vi.stubEnv("INVOCATION_ID", "test-invocation");
    vi.stubEnv("XDG_RUNTIME_DIR", `/run/user/${currentUid()}`);

    const { config } = await import("./config");

    expect(config.service.systemctlScope).toBe("user");
  });

  it("prefers an explicit system scope over auto-detection", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "neo-config-test-"));
    const logDir = mkdtempSync(join(tmpdir(), "neo-config-test-"));
    tempDirs.push(dataDir, logDir);

    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("NEO_DATA_DIR", dataDir);
    vi.stubEnv("NEO_LOG_DIR", logDir);
    vi.stubEnv("INVOCATION_ID", "test-invocation");
    vi.stubEnv("XDG_RUNTIME_DIR", `/run/user/${currentUid()}`);
    vi.stubEnv("NEO_SYSTEMCTL_SCOPE", "system");

    const { config } = await import("./config");

    expect(config.service.systemctlScope).toBe("system");
  });
});
