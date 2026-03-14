import { describe, expect, it, vi } from "vitest";

vi.mock("../logging/cost.js", () => ({
  getTokenUsageSummary: () => [],
  getDailyTokenUsage: () => [],
  formatCostUsd: (amount: number) => `$${amount.toFixed(2)}`,
}));

import { getCostSummaryWindow } from "./cost.js";

describe("getCostSummaryWindow", () => {
  it('starts "Today" at midnight UTC instead of a rolling 24-hour window', () => {
    expect(getCostSummaryWindow("", new Date("2026-03-13T18:45:12.987Z"))).toEqual({
      label: "Today",
      since: "2026-03-13 00:00:00",
    });
  });

  it("uses a rolling seven-day window for week summaries", () => {
    expect(getCostSummaryWindow("week", new Date("2026-03-13T18:45:12.987Z"))).toEqual({
      label: "Past 7 Days",
      since: "2026-03-06 18:45:12",
    });
  });

  it("uses a rolling thirty-day window for month summaries", () => {
    expect(getCostSummaryWindow("month", new Date("2026-03-13T18:45:12.987Z"))).toEqual({
      label: "Past 30 Days",
      since: "2026-02-11 18:45:12",
    });
  });

  it("returns null for unsupported arguments", () => {
    expect(getCostSummaryWindow("year", new Date("2026-03-13T18:45:12.987Z"))).toBeNull();
  });
});
