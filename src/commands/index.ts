import type { Context } from "grammy";
import { handleNewSession } from "./session.js";
import { handleModel } from "./model.js";
import { handleMemory } from "./memory.js";
import { handleLogLevel } from "./log.js";
import { handleHelp } from "./help.js";
import { handleSoul } from "./soul.js";
import { handleRestart } from "./restart.js";
import { handleSessions } from "./session.js";
import { handleStatus } from "./status.js";
import { handleAudit } from "./audit.js";
import { handleCost } from "./cost.js";
import { handleChannel } from "./channel.js";
import { commandDefinitions, getTelegramCommands } from "./definitions.js";

type CommandHandler = (ctx: Context) => Promise<unknown> | unknown;
type CommandName = (typeof commandDefinitions)[number]["command"];

type CommandRegistrar = {
  api: {
    setMyCommands: (commands: ReturnType<typeof getTelegramCommands>) => Promise<true>;
  };
  command: (command: CommandName, handler: CommandHandler) => unknown;
};

const commandHandlers = {
  start: handleHelp,
  help: handleHelp,
  new: handleNewSession,
  model: handleModel,
  sessions: handleSessions,
  memory: handleMemory,
  loglevel: handleLogLevel,
  soul: handleSoul,
  status: handleStatus,
  audit: handleAudit,
  cost: handleCost,
  channel: handleChannel,
  restart: handleRestart,
} satisfies Record<CommandName, CommandHandler>;

export async function registerCommands(bot: CommandRegistrar) {
  await bot.api.setMyCommands(getTelegramCommands());

  for (const definition of commandDefinitions) {
    bot.command(definition.command, commandHandlers[definition.command]);
  }
}
