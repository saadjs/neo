import { describe, expect, it } from "vitest";
import { buildProgressText, formatProgressName } from "./progress";

describe("formatProgressName", () => {
  it("replaces underscores and hyphens with spaces", () => {
    expect(formatProgressName("read_file")).toBe("read file");
    expect(formatProgressName("list-files")).toBe("list files");
  });

  it("collapses multiple separators", () => {
    expect(formatProgressName("read__file")).toBe("read file");
  });

  it("defaults to 'work' for falsy input", () => {
    expect(formatProgressName(undefined)).toBe("work");
    expect(formatProgressName("")).toBe("work");
  });
});

describe("buildProgressText", () => {
  const startedAt = Date.now();

  it("shows tool name when phase is tool", () => {
    expect(buildProgressText("tool", "read file", startedAt)).toMatch(/Working… using read file/);
  });

  it("shows skill name when phase is skill", () => {
    expect(buildProgressText("skill", "commit", startedAt)).toMatch(/Working… running commit/);
  });

  it("shows compacting message", () => {
    expect(buildProgressText("compacting", "", startedAt)).toMatch(/Tidying context/);
  });

  it("shows waiting message", () => {
    expect(buildProgressText("waiting", "", startedAt)).toMatch(/Waiting for your answer/);
  });

  it("shows default thinking message", () => {
    expect(buildProgressText("thinking", "", startedAt)).toMatch(/Thinking…/);
  });

  it("returns default thinking text for streaming phase", () => {
    expect(buildProgressText("streaming", "", startedAt)).toMatch(/Thinking…/);
  });

  it("includes elapsed seconds after threshold", () => {
    const oldStart = Date.now() - 15_000;
    expect(buildProgressText("thinking", "", oldStart)).toMatch(/\(15s\)/);
  });
});
