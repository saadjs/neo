import { CRON_LOOKAHEAD_YEARS } from "../constants.js";

/**
 * Minimal 5-field cron parser (min hour dom month dow).
 * Supports: *, ranges (1-5), steps (*(/)15), lists (1,3,5).
 * Pure functions, zero dependencies.
 */

const FIELD_RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0 = Sunday)
];

function parseField(field: string, [min, max]: [number, number]): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    const range = stepMatch ? stepMatch[1] : part;

    let start: number;
    let end: number;

    if (range === "*") {
      start = min;
      end = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      start = a;
      end = b;
    } else {
      start = parseInt(range, 10);
      end = start;
    }

    if (isNaN(start) || isNaN(end) || isNaN(step)) {
      throw new Error(`Invalid cron field: ${field}`);
    }
    if (start < min || end > max || start > end || step < 1) {
      throw new Error(`Out of range in cron field: ${field} (expected ${min}-${max})`);
    }

    for (let i = start; i <= end; i += step) {
      values.add(i);
    }
  }

  return values;
}

function parseCron(expression: string): Set<number>[] {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields, got ${fields.length}: "${expression}"`);
  }
  return fields.map((field, i) => parseField(field, FIELD_RANGES[i]));
}

/**
 * Returns the next time a cron expression matches, starting from `after` (exclusive).
 * Searches up to 2 years ahead.
 */
export function getNextCronTime(expression: string, after: Date): Date {
  const [minutes, hours, doms, months, dows] = parseCron(expression);

  // Round up to the next whole minute
  const cursor = new Date(after.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const limit = new Date(after.getTime());
  limit.setUTCFullYear(limit.getUTCFullYear() + CRON_LOOKAHEAD_YEARS);

  while (cursor <= limit) {
    if (
      months.has(cursor.getUTCMonth() + 1) &&
      doms.has(cursor.getUTCDate()) &&
      dows.has(cursor.getUTCDay()) &&
      hours.has(cursor.getUTCHours()) &&
      minutes.has(cursor.getUTCMinutes())
    ) {
      return cursor;
    }

    // Advance one minute
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  throw new Error(
    `No matching time found within ${CRON_LOOKAHEAD_YEARS} years for: "${expression}"`,
  );
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatTime(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return minute === 0 ? `${h}:00 ${ampm}` : `${h}:${String(minute).padStart(2, "0")} ${ampm}`;
}

/**
 * Converts a 5-field cron expression to a human-readable description.
 * Handles common patterns; falls back to the raw expression for complex ones.
 * All times are described as UTC.
 */
export function describeCron(expression: string): string {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return expression;

  const [minField, hourField, domField, monField, dowField] = fields;

  // every minute: * * * * *
  if (
    minField === "*" &&
    hourField === "*" &&
    domField === "*" &&
    monField === "*" &&
    dowField === "*"
  ) {
    return "every minute";
  }

  // every N minutes: */N * * * *
  const minStep = minField.match(/^\*\/(\d+)$/);
  if (minStep && hourField === "*" && domField === "*" && monField === "*" && dowField === "*") {
    return `every ${minStep[1]} minutes`;
  }

  // every N hours: 0 */N * * *
  const hourStep = hourField.match(/^\*\/(\d+)$/);
  if (minField === "0" && hourStep && domField === "*" && monField === "*" && dowField === "*") {
    return `every ${hourStep[1]} hours`;
  }

  // From here, we need specific minute and hour values
  const min = parseInt(minField, 10);
  const hour = parseInt(hourField, 10);
  if (isNaN(min) || isNaN(hour)) return expression;

  const time = formatTime(hour, min);

  // daily: M H * * *
  if (domField === "*" && monField === "*" && dowField === "*") {
    return `every day at ${time} UTC`;
  }

  // specific weekday(s): M H * * DOW
  if (domField === "*" && monField === "*" && dowField !== "*") {
    // weekdays: M H * * 1-5
    if (dowField === "1-5") {
      return `weekdays at ${time} UTC`;
    }
    // single day: M H * * 0-6
    const singleDow = parseInt(dowField, 10);
    if (!isNaN(singleDow) && singleDow >= 0 && singleDow <= 6) {
      return `every ${DAY_NAMES[singleDow]} at ${time} UTC`;
    }
    return expression;
  }

  // monthly: M H DOM * *
  if (monField === "*" && dowField === "*") {
    const dom = parseInt(domField, 10);
    if (!isNaN(dom)) {
      const mod10 = dom % 10;
      const mod100 = dom % 100;
      const suffix =
        mod10 === 1 && mod100 !== 11
          ? "st"
          : mod10 === 2 && mod100 !== 12
            ? "nd"
            : mod10 === 3 && mod100 !== 13
              ? "rd"
              : "th";
      return `${dom}${suffix} of every month at ${time} UTC`;
    }
  }

  return expression;
}

/**
 * Returns true if the cron expression is syntactically valid.
 */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}
