export type CommandDefinition = {
  command: string;
  description: string;
  usage?: string;
};

export const commandDefinitions = [
  {
    command: "start",
    description: "Show available commands",
  },
  {
    command: "help",
    description: "Show available commands",
  },
  {
    command: "new",
    description: "Start a fresh conversation",
  },
  {
    command: "model",
    description: "Switch the model for this chat only",
    usage: "[name]",
  },
  {
    command: "sessions",
    description: "List active sessions",
  },
  {
    command: "memory",
    description: "View or search memory",
    usage: "[query]",
  },
  {
    command: "loglevel",
    description: "Set log verbosity",
    usage: "<level>",
  },
  {
    command: "soul",
    description: "Show current persona",
  },
  {
    command: "status",
    description: "Show runtime status",
  },
  {
    command: "whichmodel",
    description: "Show default and current chat model",
  },
  {
    command: "usage",
    description: "Show Copilot monthly usage",
  },
  {
    command: "audit",
    description: "Tool usage stats",
    usage: "[week|tool]",
  },
  {
    command: "cost",
    description: "Token usage & cost",
    usage: "[week|month]",
  },
  {
    command: "channel",
    description: "Channel config (groups only)",
    usage: "[label|topics] [value]",
  },
  {
    command: "restart",
    description: "Restart Neo",
  },
] as const satisfies readonly CommandDefinition[];

export function getTelegramCommands() {
  return commandDefinitions.map(({ command, description }) => ({ command, description }));
}

export function buildHelpText() {
  const commandLines = commandDefinitions.map((definition) => {
    const suffix = "usage" in definition ? ` ${definition.usage}` : "";
    return `/${definition.command}${suffix} — ${definition.description}`;
  });

  return `**Neo — Commands**

${commandLines.join("\n")}

Notes:
- /start and /help both show this command list
- /model opens a clickable picker; /model <name> still switches directly
- /whichmodel shows default model vs this chat's active model
- /new keeps this chat's model override if you set one with /model
- Otherwise /new uses Neo's default model from config.json

Just send a message to chat.`;
}
