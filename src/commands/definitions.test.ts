import { describe, expect, it } from "vitest";
import { buildHelpText, getTelegramCommands } from "./definitions.js";

describe("getTelegramCommands", () => {
  it("includes the visible slash commands Telegram should suggest", () => {
    expect(getTelegramCommands()).toEqual([
      { command: "start", description: "Show available commands" },
      { command: "help", description: "Show available commands" },
      { command: "new", description: "Start a fresh conversation" },
      { command: "model", description: "Switch the model for this chat only" },
      { command: "sessions", description: "List active sessions" },
      { command: "memory", description: "View or search memory" },
      { command: "loglevel", description: "Set log verbosity" },
      { command: "soul", description: "Show current persona" },
      { command: "status", description: "Show runtime status" },
      { command: "usage", description: "Show Copilot monthly usage" },
      { command: "audit", description: "Tool usage stats" },
      { command: "cost", description: "Token usage & cost" },
      { command: "channel", description: "Channel config (groups only)" },
      { command: "restart", description: "Restart Neo" },
    ]);
  });
});

describe("buildHelpText", () => {
  it("renders help from the shared command definitions", () => {
    expect(buildHelpText()).toContain("/start — Show available commands");
    expect(buildHelpText()).toContain("/model <name> — Switch the model for this chat only");
    expect(buildHelpText()).toContain("/memory [query] — View or search memory");
    expect(buildHelpText()).toContain("/usage — Show Copilot monthly usage");
  });
});
