/* eslint-disable vitest/require-mock-type-parameters */
import { describe, expect, it, vi } from "vitest";

// Mock vscode-jsonrpc and Copilot SDK before other imports to prevent ESM resolution issues
vi.mock("vscode-jsonrpc/node", () => ({
  StreamMessageReader: class {},
  StreamMessageWriter: class {},
  MessageConnection: { listen: () => ({}) },
}));

vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: class {},
  defineTool: () => ({}),
}));

vi.mock("../config.js", () => ({
  config: {
    telegram: { botToken: "test-token", ownerId: 1 },
    paths: { data: "/tmp", logs: "/tmp" },
  },
}));

vi.mock("../logging/index.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../logging/conversations.js", () => ({
  searchSessionsByTag: vi.fn(() => []),
}));

vi.mock("./help.js", () => ({ handleHelp: vi.fn() }));
vi.mock("./cancel.js", () => ({ handleCancel: vi.fn() }));
vi.mock("./session.js", () => ({
  handleNewSession: vi.fn(),
  handleSessions: vi.fn(),
}));
vi.mock("./model.js", () => ({ handleModel: vi.fn() }));
vi.mock("./reasoning.js", () => ({ handleReasoning: vi.fn() }));
vi.mock("./memory.js", () => ({ handleMemory: vi.fn() }));
vi.mock("./log.js", () => ({ handleLogLevel: vi.fn() }));
vi.mock("./soul.js", () => ({ handleSoul: vi.fn() }));
vi.mock("./restart.js", () => ({ handleRestart: vi.fn() }));
vi.mock("./status.js", () => ({ handleStatus: vi.fn() }));
vi.mock("./whichmodel.js", () => ({ handleWhichModel: vi.fn() }));
vi.mock("./usage.js", () => ({ handleUsage: vi.fn() }));
vi.mock("./audit.js", () => ({ handleAudit: vi.fn() }));
vi.mock("./cost.js", () => ({ handleCost: vi.fn() }));
vi.mock("./channel.js", () => ({ handleChannel: vi.fn() }));
vi.mock("./research.js", () => ({ createResearchHandler: vi.fn(() => vi.fn()) }));
vi.mock("./jobs.js", () => ({ handleJobs: vi.fn() }));

import { registerCommands } from "./index";
import { getTelegramCommands } from "./definitions";

describe("registerCommands", () => {
  it("publishes Telegram command metadata and registers each handler", async () => {
    const setMyCommands = vi.fn().mockResolvedValue(true);
    const command = vi.fn();

    await registerCommands(
      {
        api: { setMyCommands },
        command,
      } as never,
      vi.fn() as never,
    );

    expect(setMyCommands).toHaveBeenNthCalledWith(1, getTelegramCommands());
    expect(setMyCommands).toHaveBeenNthCalledWith(2, getTelegramCommands(), {
      scope: { type: "all_private_chats" },
    });
    expect(setMyCommands).toHaveBeenNthCalledWith(3, getTelegramCommands(), {
      scope: { type: "all_group_chats" },
    });
    expect(command.mock.calls.map(([name]) => name)).toEqual(
      getTelegramCommands().map(({ command: commandName }) => commandName),
    );
  });
});
