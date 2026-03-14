function formatSqliteUtcTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function startOfUtcDay(date = new Date()): Date {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export { formatSqliteUtcTimestamp, startOfUtcDay };
