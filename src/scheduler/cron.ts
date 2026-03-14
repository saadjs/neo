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
  limit.setUTCFullYear(limit.getUTCFullYear() + 2);

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

  throw new Error(`No matching time found within 2 years for: "${expression}"`);
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
