import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { getLogger } from "../logging/index.js";
import { getLastCompletedIsoWeekEnd, groupByWeek, summarizeWeek } from "./decay-utils.js";
import type { DailyMemoryFile } from "./decay-utils.js";

export {
  getIsoWeek,
  getLastCompletedIsoWeekEnd,
  groupByWeek,
  summarizeWeek,
} from "./decay-utils.js";

const MEMORY_DIR = config.paths.memoryDir;
const SUMMARIZED_MARKER = "<!-- summarized -->";

interface StoredDailyMemoryFile extends DailyMemoryFile {
  summarized: boolean;
}

async function getCompletedWeekMemoryFiles(): Promise<StoredDailyMemoryFile[]> {
  const lastCompletedWeekEnd = getLastCompletedIsoWeekEnd();
  const files = await readdir(MEMORY_DIR);
  const completed: StoredDailyMemoryFile[] = [];

  for (const f of files) {
    const match = f.match(/^MEMORY-(\d{4}-\d{2}-\d{2})\.md$/);
    if (!match) continue;

    const date = match[1];
    if (date > lastCompletedWeekEnd) continue;

    const content = await readFile(join(MEMORY_DIR, f), "utf-8");
    completed.push({
      filename: f,
      date,
      content,
      summarized: content.startsWith(SUMMARIZED_MARKER),
    });
  }

  return completed;
}

/**
 * List daily memory files eligible for decay from completed ISO weeks.
 * Skips files already marked as summarized.
 */
export async function getDecayEligibleFiles(): Promise<DailyMemoryFile[]> {
  const log = getLogger();
  const completedFiles = await getCompletedWeekMemoryFiles();
  const eligible = completedFiles.filter((file) => !file.summarized);

  log.debug(
    { count: eligible.length, lastCompletedWeekEnd: getLastCompletedIsoWeekEnd() },
    "Found decay-eligible memory files",
  );
  return eligible.map(({ filename, date, content }) => ({ filename, date, content }));
}

async function markAsSummarized(filename: string): Promise<void> {
  const filepath = join(MEMORY_DIR, filename);
  const content = await readFile(filepath, "utf-8");
  if (content.startsWith(SUMMARIZED_MARKER)) return;
  await writeFile(filepath, `${SUMMARIZED_MARKER}\n${content}`, "utf-8");
}

/**
 * Run the full memory decay process.
 * Returns the number of files processed.
 */
export async function runMemoryDecay(): Promise<number> {
  const log = getLogger();
  const completedFiles = await getCompletedWeekMemoryFiles();
  const weeks = groupByWeek(
    completedFiles.map(({ filename, date, content }) => ({ filename, date, content })),
  );

  let processed = 0;
  let decayedWeeks = 0;

  for (const [week, files] of weeks) {
    const pendingFiles = files.filter((file) => {
      const storedFile = completedFiles.find((candidate) => candidate.filename === file.filename);
      return storedFile && !storedFile.summarized;
    });

    if (pendingFiles.length === 0) {
      continue;
    }

    const summaryContent = summarizeWeek(week, files);
    const summaryFilename = `MEMORY-SUMMARY-${week}.md`;
    const summaryPath = join(MEMORY_DIR, summaryFilename);

    await writeFile(summaryPath, summaryContent, "utf-8");
    log.info(
      { week, files: files.length, pendingFiles: pendingFiles.length, summaryFilename },
      "Wrote weekly memory summary",
    );

    for (const file of pendingFiles) {
      await markAsSummarized(file.filename);
      processed++;
    }

    decayedWeeks++;
  }

  if (processed === 0) {
    log.info("No memory files eligible for decay");
    return 0;
  }

  log.info({ processed, weeks: decayedWeeks }, "Memory decay complete");
  return processed;
}

/**
 * Load recent weekly summaries for system context.
 */
export async function loadRecentSummaries(maxWeeks = 4): Promise<string> {
  const files = await readdir(MEMORY_DIR);
  const summaryFiles = files
    .filter((f) => f.match(/^MEMORY-SUMMARY-\d{4}-W\d{2}\.md$/))
    .sort()
    .reverse()
    .slice(0, maxWeeks);

  if (summaryFiles.length === 0) return "";

  const contents: string[] = [];
  for (const f of summaryFiles) {
    const content = await readFile(join(MEMORY_DIR, f), "utf-8");
    contents.push(content.trim());
  }

  return contents.join("\n\n---\n\n");
}
