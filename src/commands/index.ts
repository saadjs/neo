import type { Context } from "grammy";
import { handleNewSession } from "./session";
import { handleCancel } from "./cancel";
import { handleModel } from "./model";
import { handleMemory } from "./memory";
import { handleLogLevel } from "./log";
import { handleHelp } from "./help";
import { handleSoul } from "./soul";
import { handleRestart } from "./restart";
import { handleSessions } from "./session";
import { handleStatus } from "./status";
import { handleWhichModel } from "./whichmodel";
import { handleAudit } from "./audit";
import { handleCost } from "./cost";
import { handleChannel } from "./channel";
import { handleUsage } from "./usage";
import { handleReasoning } from "./reasoning";
import { handleJobs } from "./jobs";
import { commandDefinitions, getTelegramCommands } from "./definitions";

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
  reasoning: handleReasoning,
  sessions: handleSessions,
  memory: handleMemory,
  loglevel: handleLogLevel,
  soul: handleSoul,
  status: handleStatus,
  whichmodel: handleWhichModel,
  audit: handleAudit,
  cost: handleCost,
  usage: handleUsage,
  jobs: handleJobs,
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
