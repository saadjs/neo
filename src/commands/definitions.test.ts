import { describe, expect, it } from "vitest";
import { buildHelpText, getTelegramCommands } from "./definitions.js";

describe("getTelegramCommands", () => {
  it("includes the visible slash commands Telegram should suggest", () => {
    expect(getTelegramCommands()).toEqual([
      { command: "start", description: "Show available commands" },
      { command: "help", description: "Show available commands" },
      { command: "new", description: "Start a fresh conversation" },
      { command: "cancel", description: "Cancel the current task" },
      { command: "model", description: "Switch the model for this chat only" },
      { command: "sessions", description: "List active sessions" },
      { command: "memory", description: "View, search, or filter memory" },
      { command: "loglevel", description: "Set log verbosity" },
      { command: "soul", description: "Show current persona" },
      { command: "status", description: "Show runtime status" },
      { command: "whichmodel", description: "Show default and current chat model" },
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
