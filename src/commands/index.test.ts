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
    info: vi.fn<any>(),
    warn: vi.fn<any>(),
    error: vi.fn<any>(),
    debug: vi.fn<any>(),
  }),
}));

vi.mock("../logging/conversations.js", () => ({
  searchSessionsByTag: vi.fn<any>(() => []),
}));

vi.mock("./help.js", () => ({ handleHelp: vi.fn<any>() }));
vi.mock("./cancel.js", () => ({ handleCancel: vi.fn<any>() }));
vi.mock("./session.js", () => ({
  handleNewSession: vi.fn<any>(),
  handleSessions: vi.fn<any>(),
}));
vi.mock("./model.js", () => ({ handleModel: vi.fn<any>() }));
vi.mock("./reasoning.js", () => ({ handleReasoning: vi.fn<any>() }));
vi.mock("./memory.js", () => ({ handleMemory: vi.fn<any>() }));
vi.mock("./log.js", () => ({ handleLogLevel: vi.fn<any>() }));
vi.mock("./soul.js", () => ({ handleSoul: vi.fn<any>() }));
vi.mock("./restart.js", () => ({ handleRestart: vi.fn<any>() }));
vi.mock("./status.js", () => ({ handleStatus: vi.fn<any>() }));
vi.mock("./whichmodel.js", () => ({ handleWhichModel: vi.fn<any>() }));
vi.mock("./usage.js", () => ({ handleUsage: vi.fn<any>() }));
vi.mock("./audit.js", () => ({ handleAudit: vi.fn<any>() }));
vi.mock("./cost.js", () => ({ handleCost: vi.fn<any>() }));
vi.mock("./channel.js", () => ({ handleChannel: vi.fn<any>() }));
vi.mock("./research.js", () => ({ createResearchHandler: vi.fn<any>(() => vi.fn<any>()) }));
vi.mock("./jobs.js", () => ({ handleJobs: vi.fn<any>() }));

import { registerCommands } from "./index";
import { getTelegramCommands } from "./definitions";

describe("registerCommands", () => {
  it("publishes Telegram command metadata and registers each handler", async () => {
    const setMyCommands = vi.fn<any>().mockResolvedValue(true);
    const command = vi.fn<any>();

    await registerCommands(
      {
        api: { setMyCommands },
        command,
      } as never,
      vi.fn<any>() as never,
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
