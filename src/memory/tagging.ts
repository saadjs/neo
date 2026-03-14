/**
 * Extract topic tags from a compaction summary using keyword extraction.
 * Returns 2-3 lowercase tags.
 */
export function extractTags(summary: string): string[] {
  const TOPIC_KEYWORDS: Record<string, string[]> = {
    coding: [
      "code",
      "function",
      "bug",
      "refactor",
      "typescript",
      "javascript",
      "python",
      "api",
      "endpoint",
      "deploy",
      "build",
      "test",
      "lint",
      "git",
      "commit",
      "pr",
      "pull request",
      "merge",
    ],
    browser: [
      "browser",
      "playwright",
      "screenshot",
      "navigate",
      "click",
      "website",
      "page",
      "scrape",
      "web automation",
    ],
    email: ["email", "gmail", "inbox", "send mail", "draft"],
    calendar: ["calendar", "meeting", "schedule", "event", "appointment"],
    search: ["search", "lookup", "find", "web search"],
    memory: ["memory", "remember", "preference", "soul", "identity"],
    system: ["restart", "config", "setting", "status", "systemctl", "deploy"],
    files: ["file", "directory", "folder", "read file", "write file", "download", "upload"],
    reminder: ["reminder", "remind", "alarm", "notify", "notification"],
    job: ["job", "cron", "schedule", "recurring", "automation"],
    chat: ["conversation", "chat", "discuss", "brainstorm", "idea"],
    finance: ["money", "price", "cost", "budget", "invest", "stock", "crypto", "payment"],
    health: ["health", "exercise", "workout", "diet", "sleep", "medical"],
    travel: ["travel", "flight", "hotel", "trip", "booking", "destination"],
    shopping: ["buy", "order", "purchase", "amazon", "shop", "product"],
  };

  const lowerSummary = summary.toLowerCase();
  const scored: Array<[string, number]> = [];

  for (const [tag, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      let idx = 0;
      while ((idx = lowerSummary.indexOf(kw, idx)) !== -1) {
        score++;
        idx += kw.length;
      }
    }
    if (score > 0) scored.push([tag, score]);
  }

  scored.sort((a, b) => b[1] - a[1]);
  const tags = scored.slice(0, 3).map(([tag]) => tag);

  return tags.length > 0 ? tags : ["general"];
}
