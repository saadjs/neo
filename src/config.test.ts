import { mkdtempSync, rmSync } from "node:fs";
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

    const { config } = await import("./config.js");

    expect(config.browser.credentials.github).toEqual({
      username: "neo@example.com",
      password: "  secret  ",
    });
  });
});
