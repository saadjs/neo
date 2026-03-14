import type { Bot } from "grammy";
import { handleNewSession } from "./session.js";
import { handleModel } from "./model.js";
import { handleMemory } from "./memory.js";
import { handleLogLevel } from "./log.js";
import { handleHelp } from "./help.js";
import { handleSoul } from "./soul.js";
import { handleRestart } from "./restart.js";
import { handleSessions } from "./session.js";
import { handleStatus } from "./status.js";

export function registerCommands(bot: Bot) {
  bot.command("new", handleNewSession);
  bot.command("model", handleModel);
  bot.command("sessions", handleSessions);
  bot.command("memory", handleMemory);
  bot.command("loglevel", handleLogLevel);
  bot.command("help", handleHelp);
  bot.command("soul", handleSoul);
  bot.command("status", handleStatus);
  bot.command("restart", handleRestart);
  bot.command("start", handleHelp); // Telegram's default /start
}
