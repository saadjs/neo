import type { Context } from "grammy";
import { setLogLevel, getLogLevel, type LogLevel } from "../logging/index.js";

const VALID_LEVELS: LogLevel[] = ["error", "warn", "info", "debug", "trace"];

export async function handleLogLevel(ctx: Context) {
  const text = ctx.message?.text ?? "";
  const level = text.replace(/^\/loglevel\s*/, "").trim().toLowerCase();

  if (!level) {
    await ctx.reply(`Current log level: \`${getLogLevel()}\`\nUsage: \`/loglevel <${VALID_LEVELS.join("|")}>\``, {
      parse_mode: "Markdown",
    });
    return;
  }

  if (!VALID_LEVELS.includes(level as LogLevel)) {
    await ctx.reply(`Invalid level. Choose: ${VALID_LEVELS.join(", ")}`);
    return;
  }

  setLogLevel(level as LogLevel);
  await ctx.reply(`Log level set to \`${level}\`.`, { parse_mode: "Markdown" });
}
