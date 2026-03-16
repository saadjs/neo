import { describe, expect, it } from "vitest";
import { describeCron, getNextCronTime, isValidCron } from "./cron.js";

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

describe("describeCron", () => {
  it("describes every-minute schedule", () => {
    expect(describeCron("* * * * *")).toBe("every minute");
  });

  it("describes step-minute schedules", () => {
    expect(describeCron("*/15 * * * *")).toBe("every 15 minutes");
    expect(describeCron("*/5 * * * *")).toBe("every 5 minutes");
  });

  it("describes step-hour schedules", () => {
    expect(describeCron("0 */2 * * *")).toBe("every 2 hours");
  });

  it("describes daily schedules", () => {
    expect(describeCron("0 0 * * *")).toBe("every day at 12:00 AM UTC");
    expect(describeCron("30 9 * * *")).toBe("every day at 9:30 AM UTC");
    expect(describeCron("0 14 * * *")).toBe("every day at 2:00 PM UTC");
  });

  it("describes weekly schedules", () => {
    expect(describeCron("0 3 * * 0")).toBe("every Sunday at 3:00 AM UTC");
    expect(describeCron("0 9 * * 1")).toBe("every Monday at 9:00 AM UTC");
  });

  it("describes weekday schedules", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("weekdays at 9:00 AM UTC");
  });

  it("describes monthly schedules", () => {
    expect(describeCron("30 9 1 * *")).toBe("1st of every month at 9:30 AM UTC");
    expect(describeCron("0 10 2 * *")).toBe("2nd of every month at 10:00 AM UTC");
    expect(describeCron("0 10 3 * *")).toBe("3rd of every month at 10:00 AM UTC");
    expect(describeCron("0 10 15 * *")).toBe("15th of every month at 10:00 AM UTC");
    expect(describeCron("0 10 21 * *")).toBe("21st of every month at 10:00 AM UTC");
    expect(describeCron("0 10 22 * *")).toBe("22nd of every month at 10:00 AM UTC");
    expect(describeCron("0 10 23 * *")).toBe("23rd of every month at 10:00 AM UTC");
    expect(describeCron("0 10 31 * *")).toBe("31st of every month at 10:00 AM UTC");
  });

  it("falls back to raw expression for complex patterns", () => {
    expect(describeCron("0 9 1,15 * 0")).toBe("0 9 1,15 * 0");
  });

  it("falls back for invalid field count", () => {
    expect(describeCron("* * *")).toBe("* * *");
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
