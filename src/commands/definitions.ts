export type CommandDefinition = {
  command: string;
  description: string;
  usage?: string;
};

export const commandDefinitions = [
  {
    command: "audit",
    description: "Tool usage stats",
    usage: "[week|tool]",
  },
  {
    command: "cancel",
    description: "Cancel the current task",
  },
  {
    command: "channel",
    description: "Channel config (groups only)",
    usage: "[label|topics|model|reasoning] [value]",
  },
  {
    command: "context",
    description: "Show session context summary",
  },
  {
    command: "cost",
    description: "Token usage & cost",
    usage: "[week|month]",
  },
  {
    command: "help",
    description: "Show available commands",
  },
  {
    command: "jobs",
    description: "List and manage scheduled jobs",
    usage: "[history <name>|cancel]",
  },
  {
    command: "loglevel",
    description: "Set log verbosity",
    usage: "<level>",
  },
  {
    command: "memory",
    description: "View, search, or filter memory",
    usage: "[query]",
  },
  {
    command: "model",
    description: "Switch the model for this chat only",
    usage: "[name]",
  },
  {
    command: "new",
    description: "Start a fresh conversation",
  },
  {
    command: "reasoning",
    description: "Set reasoning effort for this chat",
    usage: "[level|reset]",
  },
  {
    command: "restart",
    description: "Restart Neo",
  },
  {
    command: "sessions",
    description: "List and resume sessions",
  },
  {
    command: "soul",
    description: "Show current persona",
  },
  {
    command: "start",
    description: "Show available commands",
  },
  {
    command: "status",
    description: "Show runtime status",
  },
  {
    command: "usage",
    description: "Show Copilot monthly usage",
  },
  {
    command: "whichmodel",
    description: "Show default and current chat model",
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
- /memory supports full-text search, /memory recent N, and /memory #tag
- /whichmodel shows default model vs this chat's active model
- /new keeps this chat's model override if you set one with /model
- Otherwise /new uses Neo's default model from config.json

Just send a message to chat.`;
}
