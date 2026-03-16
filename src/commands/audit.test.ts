import { describe, expect, it, vi } from "vitest";

vi.mock("../logging/audit-queries.js", () => ({
  getToolUsageSummary: () => [],
  getToolHistory: () => [],
  getSessionStats: () => ({
    total_tool_calls: 0,
  }),
}));

import { getAuditSummaryWindow } from "./audit";

describe("getAuditSummaryWindow", () => {
  it('starts "Today" at midnight UTC instead of a rolling 24-hour window', () => {
    expect(getAuditSummaryWindow("", new Date("2026-03-13T18:45:12.987Z"))).toEqual({
      label: "Today",
      since: "2026-03-13 00:00:00",
    });
  });

  it("keeps the past-week shortcut as a rolling seven-day window", () => {
    expect(getAuditSummaryWindow("week", new Date("2026-03-13T18:45:12.987Z"))).toEqual({
      label: "Past 7 Days",
      since: "2026-03-06 18:45:12",
    });
  });

  it("returns null for tool-history lookups", () => {
    expect(getAuditSummaryWindow("browser", new Date("2026-03-13T18:45:12.987Z"))).toBeNull();
  });
});
