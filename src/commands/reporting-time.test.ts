import { describe, expect, it, vi } from "vitest";
import { formatSqliteUtcTimestamp, startOfUtcDay } from "./reporting-time.js";

describe("reporting time helpers", () => {
  it("formats UTC timestamps to match SQLite datetime('now') text", () => {
    expect(formatSqliteUtcTimestamp(new Date("2026-03-13T16:45:12.987Z"))).toBe(
      "2026-03-13 16:45:12",
    );
  });

  it("returns midnight UTC without ISO separators", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T16:45:12.987Z"));

    expect(formatSqliteUtcTimestamp(startOfUtcDay())).toBe("2026-03-13 00:00:00");

    vi.useRealTimers();
  });

  it("normalizes an arbitrary date to its UTC day boundary", () => {
    expect(formatSqliteUtcTimestamp(startOfUtcDay(new Date("2026-03-13T23:59:59.999-05:00")))).toBe(
      "2026-03-14 00:00:00",
    );
  });
});
