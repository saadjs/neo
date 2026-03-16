import type { Context } from "grammy";
import { getLogLevel, type LogLevel } from "../logging/index";
import { applyConfigChange } from "../runtime/state";

const VALID_LEVELS: LogLevel[] = ["error", "warn", "info", "debug", "trace"];

export async function handleLogLevel(ctx: Context) {
  const text = ctx.message?.text ?? "";
  const level = text
    .replace(/^\/loglevel\s*/, "")
    .trim()
    .toLowerCase();

  if (!level) {
    await ctx.reply(
      `Current log level: \`${getLogLevel()}\`\nUsage: \`/loglevel <${VALID_LEVELS.join("|")}>\``,
      {
        parse_mode: "Markdown",
      },
    );
    return;
  }

  if (!VALID_LEVELS.includes(level as LogLevel)) {
    await ctx.reply(`Invalid level. Choose: ${VALID_LEVELS.join(", ")}`);
    return;
  }

  const result = await applyConfigChange({
    key: "NEO_LOG_LEVEL",
    value: level,
    actor: "telegram-owner",
    source: "command",
    reason: "/loglevel command",
  });

  await ctx.reply(`Log level set to \`${level}\`.\n${result.reason}`, {
    parse_mode: "Markdown",
  });
}
