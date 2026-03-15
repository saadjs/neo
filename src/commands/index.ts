import type { Context } from "grammy";
import { handleNewSession } from "./session.js";
import { handleCancel } from "./cancel.js";
import { handleModel } from "./model.js";
import { handleMemory } from "./memory.js";
import { handleLogLevel } from "./log.js";
import { handleHelp } from "./help.js";
import { handleSoul } from "./soul.js";
import { handleRestart } from "./restart.js";
import { handleSessions } from "./session.js";
import { handleStatus } from "./status.js";
import { handleWhichModel } from "./whichmodel.js";
import { handleAudit } from "./audit.js";
import { handleCost } from "./cost.js";
import { handleChannel } from "./channel.js";
import { handleUsage } from "./usage.js";
import { commandDefinitions, getTelegramCommands } from "./definitions.js";

type CommandHandler = (ctx: Context) => Promise<unknown> | unknown;
type CommandName = (typeof commandDefinitions)[number]["command"];

type CommandRegistrar = {
  api: {
    setMyCommands: (
      commands: ReturnType<typeof getTelegramCommands>,
      options?: { scope?: { type: "default" | "all_private_chats" | "all_group_chats" } },
    ) => Promise<true>;
  };
  command: (command: CommandName, handler: CommandHandler) => unknown;
};

const commandHandlers = {
  start: handleHelp,
  help: handleHelp,
  new: handleNewSession,
  cancel: handleCancel,
  model: handleModel,
  sessions: handleSessions,
  memory: handleMemory,
  loglevel: handleLogLevel,
  soul: handleSoul,
  status: handleStatus,
  whichmodel: handleWhichModel,
  audit: handleAudit,
  cost: handleCost,
  usage: handleUsage,
  channel: handleChannel,
  restart: handleRestart,
} satisfies Record<CommandName, CommandHandler>;

export async function registerCommands(bot: CommandRegistrar) {
  const commands = getTelegramCommands();

  await bot.api.setMyCommands(commands);
  await bot.api.setMyCommands(commands, { scope: { type: "all_private_chats" } });
  await bot.api.setMyCommands(commands, { scope: { type: "all_group_chats" } });

  for (const definition of commandDefinitions) {
    bot.command(definition.command, commandHandlers[definition.command]);
  }
}
