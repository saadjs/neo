import { describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    telegram: {
      ownerId: 123,
    },
  },
}));

vi.mock("../logging/index.js", () => ({
  getLogger: () => ({
    info: () => {},
    error: () => {},
  }),
}));

vi.mock("./db.js", () => ({
  initRemindersTable: () => {},
  getDueReminders: () => [],
  markFired: () => {},
}));

vi.mock("./job-runner.js", () => ({
  executeJob: async () => {},
}));

vi.mock("./jobs-db.js", () => ({
  initJobsTable: () => {},
  getDueJobs: () => [],
  advanceNextRun: () => {},
}));

vi.mock("../memory/index.js", () => ({
  runMemoryDecay: async () => 0,
}));

import { shouldRunWeeklyMemoryDecay, shouldStartWeeklyMemoryDecay } from "./index.js";

describe("shouldRunWeeklyMemoryDecay", () => {
  it("uses UTC for the weekly decay window", () => {
    expect(shouldRunWeeklyMemoryDecay(new Date("2026-03-14T22:00:15-05:00"))).toBe(true);
  });

  it("does not trigger for 3 AM in another timezone when it is not 3 AM UTC", () => {
    expect(shouldRunWeeklyMemoryDecay(new Date("2026-03-15T03:00:15-04:00"))).toBe(false);
  });
});

describe("shouldStartWeeklyMemoryDecay", () => {
  it("claims the weekly decay run only once per scheduled Sunday", () => {
    expect(shouldStartWeeklyMemoryDecay(new Date("2026-03-15T03:00:00.000Z"))).toBe(true);
    expect(shouldStartWeeklyMemoryDecay(new Date("2026-03-15T03:00:30.000Z"))).toBe(false);
    expect(shouldStartWeeklyMemoryDecay(new Date("2026-03-22T03:00:00.000Z"))).toBe(true);
  });
});
