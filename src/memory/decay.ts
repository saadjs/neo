import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config";
import { getLogger } from "../logging/index";
import { getLastCompletedIsoWeekEnd, groupByWeek, summarizeWeek } from "./decay-utils";
import type { DailyMemoryFile } from "./decay-utils";
import { SUMMARIZED_MARKER } from "../constants";

export { getIsoWeek, getLastCompletedIsoWeekEnd, groupByWeek, summarizeWeek } from "./decay-utils";

interface StoredDailyMemoryFile extends DailyMemoryFile {
  summarized: boolean;
}

async function getCompletedWeekMemoryFiles(): Promise<StoredDailyMemoryFile[]> {
  const lastCompletedWeekEnd = getLastCompletedIsoWeekEnd();
  const files = await readdir(config.paths.memoryDir);
  const completed: StoredDailyMemoryFile[] = [];

  for (const f of files) {
    // Global files: MEMORY-YYYY-MM-DD.md
    const globalMatch = f.match(/^MEMORY-(\d{4}-\d{2}-\d{2})\.md$/);
    if (globalMatch) {
      const date = globalMatch[1];
      if (date > lastCompletedWeekEnd) continue;

      const content = await readFile(join(config.paths.memoryDir, f), "utf-8");
      completed.push({
        filename: f,
        date,
        content,
        summarized: content.startsWith(SUMMARIZED_MARKER),
      });
      continue;
    }

    // Channel files: MEMORY-{chatId}-YYYY-MM-DD.md (chatId can be negative for groups)
    const channelMatch = f.match(/^MEMORY-(-?\d+)-(\d{4}-\d{2}-\d{2})\.md$/);
    if (channelMatch) {
      const chatId = channelMatch[1];
      const date = channelMatch[2];
      if (date > lastCompletedWeekEnd) continue;

      const content = await readFile(join(config.paths.memoryDir, f), "utf-8");
      completed.push({
        filename: f,
        date,
        content,
        chatId,
        summarized: content.startsWith(SUMMARIZED_MARKER),
      });
    }
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
  return eligible.map(({ filename, date, content, chatId }) => ({
    filename,
    date,
    content,
    chatId,
  }));
}

async function markAsSummarized(filename: string): Promise<void> {
  const filepath = join(config.paths.memoryDir, filename);
  const content = await readFile(filepath, "utf-8");
  if (content.startsWith(SUMMARIZED_MARKER)) return;
  await writeFile(filepath, `${SUMMARIZED_MARKER}\n${content}`, "utf-8");
}

function groupKey(file: StoredDailyMemoryFile): string {
  return file.chatId != null ? String(file.chatId) : "global";
}

function summaryFilename(week: string, chatId?: string): string {
  return chatId != null ? `MEMORY-SUMMARY-ch${chatId}-${week}.md` : `MEMORY-SUMMARY-${week}.md`;
}

/**
 * Run the full memory decay process.
 * Returns the number of files processed.
 */
export async function runMemoryDecay(): Promise<number> {
  const log = getLogger();
  const completedFiles = await getCompletedWeekMemoryFiles();

  // Group files by channel scope first
  const byScope = new Map<string, StoredDailyMemoryFile[]>();
  for (const file of completedFiles) {
    const key = groupKey(file);
    const group = byScope.get(key) ?? [];
    group.push(file);
    byScope.set(key, group);
  }

  let processed = 0;
  let decayedWeeks = 0;

  for (const [scope, scopeFiles] of byScope) {
    const chatId = scope === "global" ? undefined : scope;
    const strippedFiles = scopeFiles.map(({ filename, date, content, chatId: cid }) => ({
      filename,
      date,
      content,
      chatId: cid,
    }));
    const weeks = groupByWeek(strippedFiles);

    for (const [week, files] of weeks) {
      const pendingFiles = files.filter((file) => {
        const storedFile = scopeFiles.find((candidate) => candidate.filename === file.filename);
        return storedFile && !storedFile.summarized;
      });

      if (pendingFiles.length === 0) {
        continue;
      }

      const summaryContent = summarizeWeek(week, files);
      const sumFilename = summaryFilename(week, chatId);
      const summaryPath = join(config.paths.memoryDir, sumFilename);

      await writeFile(summaryPath, summaryContent, "utf-8");
      log.info(
        {
          week,
          scope,
          files: files.length,
          pendingFiles: pendingFiles.length,
          summaryFilename: sumFilename,
        },
        "Wrote weekly memory summary",
      );

      for (const file of pendingFiles) {
        await markAsSummarized(file.filename);
        processed++;
      }

      decayedWeeks++;
    }
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
export async function loadRecentSummaries(maxWeeks = 4, chatId?: string): Promise<string> {
  const files = await readdir(config.paths.memoryDir);

  let pattern: RegExp;
  if (chatId != null) {
    // Escape the chatId for regex (negative numbers have a dash)
    const escaped = String(chatId).replace("-", "\\-");
    pattern = new RegExp(`^MEMORY-SUMMARY-ch${escaped}-\\d{4}-W\\d{2}\\.md$`);
  } else {
    pattern = /^MEMORY-SUMMARY-\d{4}-W\d{2}\.md$/;
  }

  const summaryFiles = files
    .filter((f) => pattern.test(f))
    .sort()
    .reverse()
    .slice(0, maxWeeks);

  if (summaryFiles.length === 0) return "";

  const contents: string[] = [];
  for (const f of summaryFiles) {
    const content = await readFile(join(config.paths.memoryDir, f), "utf-8");
    contents.push(content.trim());
  }

  return contents.join("\n\n---\n\n");
}
