import type { Context } from "grammy";
import {
  loadPreferences,
  readDailyMemory,
  searchMemory,
  listMemoryFiles,
} from "../memory/index.js";

export async function handleMemory(ctx: Context) {
  const text = ctx.message?.text ?? "";
  const arg = text.replace(/^\/memory\s*/, "").trim();

  if (!arg) {
    // Show summary
    const files = await listMemoryFiles();
    const prefs = await loadPreferences();
    const today = await readDailyMemory();

    let msg = `**Memory overview:**\n`;
    msg += `• ${files.length} daily memory file(s)\n`;
    msg += `• Preferences: ${prefs.split("\n").length - 1} entries\n`;
    if (today.trim()) {
      msg += `\n**Today's memory:**\n${today.slice(0, 1000)}`;
    }
    await ctx.reply(msg, { parse_mode: "Markdown" });
    return;
  }

  // Search
  const results = await searchMemory(arg);
  await ctx
    .reply(results.slice(0, 4000), { parse_mode: "Markdown" })
    .catch(() => ctx.reply(results.slice(0, 4000)));
}
