interface DailyMemoryFile {
  filename: string;
  date: string; // YYYY-MM-DD
  content: string;
}

export type { DailyMemoryFile };

const SUMMARIZED_MARKER = "<!-- summarized -->";

/**
 * Get the ISO week string for a date: YYYY-WNN
 */
export function getIsoWeek(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00Z");
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function formatDateUtc(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Get the Sunday date for the most recently completed ISO week.
 */
export function getLastCompletedIsoWeekEnd(referenceDate = new Date()): string {
  const current = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate(),
    ),
  );
  const dayNum = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() - (dayNum - 1));
  current.setUTCDate(current.getUTCDate() - 1);
  return formatDateUtc(current);
}

/**
 * Group daily memory files by ISO week.
 */
export function groupByWeek(files: DailyMemoryFile[]): Map<string, DailyMemoryFile[]> {
  const groups = new Map<string, DailyMemoryFile[]>();
  for (const file of files) {
    const week = getIsoWeek(file.date);
    const group = groups.get(week) ?? [];
    group.push(file);
    groups.set(week, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.date.localeCompare(b.date));
  }
  return groups;
}

/**
 * Create a condensed summary from a week's daily memory entries.
 * Extracts bullet points and deduplicates.
 */
export function summarizeWeek(week: string, files: DailyMemoryFile[]): string {
  const dateRange = `${files[0].date} to ${files[files.length - 1].date}`;
  let summary = `# Weekly Summary — ${week}\n`;
  summary += `> ${dateRange} (${files.length} days)\n\n`;

  const bullets: string[] = [];
  for (const file of files) {
    const lines = file.content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        !trimmed ||
        trimmed === SUMMARIZED_MARKER ||
        trimmed.startsWith("#") ||
        trimmed.startsWith(">") ||
        trimmed.startsWith("- Timestamp:") ||
        trimmed.startsWith("- Chat ID:") ||
        trimmed.startsWith("- Session ID:") ||
        trimmed.startsWith("- Tokens") ||
        trimmed.startsWith("- Messages Removed") ||
        trimmed.startsWith("- Checkpoint") ||
        trimmed.startsWith("- Model:")
      ) {
        continue;
      }
      bullets.push(trimmed);
    }
  }

  const unique = [...new Set(bullets)];

  if (unique.length === 0) {
    summary += "_No notable entries this week._\n";
  } else {
    for (const bullet of unique) {
      summary += `${bullet}\n`;
    }
  }

  return summary;
}
