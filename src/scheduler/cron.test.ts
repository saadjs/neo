import { describe, expect, it } from "vitest";
import { getNextCronTime, isValidCron } from "./cron.js";

describe("isValidCron", () => {
  it("accepts basic valid 5-field expressions", () => {
    expect(isValidCron("* * * * *")).toBe(true);
    expect(isValidCron("*/15 9-17 * * 1-5")).toBe(true);
    expect(isValidCron("0 0 1,15 * 0")).toBe(true);
  });

  it("rejects malformed or out-of-range expressions", () => {
    expect(isValidCron("* * * *")).toBe(false);
    expect(isValidCron("60 * * * *")).toBe(false);
    expect(isValidCron("* 24 * * *")).toBe(false);
    expect(isValidCron("*/0 * * * *")).toBe(false);
    expect(isValidCron("5-1 * * * *")).toBe(false);
  });
});

describe("getNextCronTime", () => {
  it("rounds up to the next whole minute and treats the start time as exclusive", () => {
    const after = new Date("2026-03-13T10:00:30.000Z");

    expect(getNextCronTime("* * * * *", after).toISOString()).toBe("2026-03-13T10:01:00.000Z");
    expect(getNextCronTime("0 10 * * *", after).toISOString()).toBe("2026-03-14T10:00:00.000Z");
  });

  it("supports stepped schedules", () => {
    const after = new Date("2026-03-13T10:07:10.000Z");

    expect(getNextCronTime("*/15 * * * *", after).toISOString()).toBe("2026-03-13T10:15:00.000Z");
  });

  it("requires both day-of-month and day-of-week to match", () => {
    const after = new Date("2026-03-13T00:00:00.000Z");

    expect(getNextCronTime("0 9 15 * 1", after).toISOString()).toBe("2026-06-15T09:00:00.000Z");
  });

  it("throws for invalid cron expressions", () => {
    expect(() => getNextCronTime("bad expression", new Date("2026-03-13T00:00:00.000Z"))).toThrow(
      /Cron expression must have 5 fields/,
    );
  });
});
