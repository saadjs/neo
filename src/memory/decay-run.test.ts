import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  memoryDir: "",
}));

vi.mock("../config.js", () => ({
  config: {
    paths: {
      memoryDir: state.memoryDir,
    },
  },
}));

vi.mock("../logging/index.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

let tempDir = "";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-20T12:00:00.000Z"));
  tempDir = mkdtempSync(join(tmpdir(), "neo-memory-decay-"));
  state.memoryDir = tempDir;
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  tempDir = "";
  state.memoryDir = "";
});

describe("runMemoryDecay", () => {
  it("rebuilds a weekly summary from all files in the week after a partial prior run", async () => {
    writeFileSync(
      join(tempDir, "MEMORY-2026-03-02.md"),
      "<!-- summarized -->\n# Memory — 2026-03-02\n- Fixed login bug\n",
    );
    writeFileSync(
      join(tempDir, "MEMORY-2026-03-03.md"),
      "# Memory — 2026-03-03\n- Shipped audit fix\n",
    );
    writeFileSync(
      join(tempDir, "MEMORY-SUMMARY-2026-W10.md"),
      "# Weekly Summary — 2026-W10\n> 2026-03-02 to 2026-03-03 (2 days)\n\n- Fixed login bug\n- Shipped audit fix\n",
    );

    const { runMemoryDecay } = await import("./decay.js");
    const processed = await runMemoryDecay();

    expect(processed).toBe(1);

    const summary = readFileSync(join(tempDir, "MEMORY-SUMMARY-2026-W10.md"), "utf-8");
    expect(summary).toContain("- Fixed login bug");
    expect(summary).toContain("- Shipped audit fix");
    expect(summary).not.toContain("<!-- summarized -->");

    const remainingFile = readFileSync(join(tempDir, "MEMORY-2026-03-03.md"), "utf-8");
    expect(remainingFile.startsWith("<!-- summarized -->\n")).toBe(true);
  });
});
