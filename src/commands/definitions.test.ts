import { describe, expect, it } from "vitest";
import { buildHelpText, getTelegramCommands } from "./definitions";

describe("getTelegramCommands", () => {
  it("includes the visible slash commands Telegram should suggest", () => {
    expect(getTelegramCommands()).toEqual([
      { command: "audit", description: "Tool usage stats" },
      { command: "cancel", description: "Cancel the current task" },
      { command: "channel", description: "Channel config (groups only)" },
      { command: "context", description: "Show session context summary" },
      { command: "cost", description: "Token usage & cost" },
      { command: "help", description: "Show available commands" },
      { command: "jobs", description: "List and manage scheduled jobs" },
      { command: "loglevel", description: "Set log verbosity" },
      { command: "memory", description: "View, search, or filter memory" },
      { command: "model", description: "Switch the model for this chat only" },
      { command: "new", description: "Start a fresh conversation" },
      { command: "reasoning", description: "Set reasoning effort for this chat" },
      { command: "restart", description: "Restart Neo" },
      { command: "sessions", description: "List and resume sessions" },
      { command: "soul", description: "Show current persona" },
      { command: "start", description: "Show available commands" },
      { command: "status", description: "Show runtime status" },
      { command: "usage", description: "Show Copilot monthly usage" },
      { command: "whichmodel", description: "Show default and current chat model" },
    ]);
  });
});

describe("buildHelpText", () => {
  it("renders help from the shared command definitions", () => {
    expect(buildHelpText()).toContain("/start — Show available commands");
    expect(buildHelpText()).toContain("/model [name] — Switch the model for this chat only");
    expect(buildHelpText()).toContain("/memory [query] — View, search, or filter memory");
    expect(buildHelpText()).toContain("/whichmodel — Show default and current chat model");
    expect(buildHelpText()).toContain("/usage — Show Copilot monthly usage");
    expect(buildHelpText()).toContain(
      "/model opens a clickable picker; /model <name> still switches directly",
    );
    expect(buildHelpText()).toContain(
      "/memory supports full-text search, /memory recent N, and /memory #tag",
    );
  });
});
