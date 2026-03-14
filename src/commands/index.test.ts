import { describe, expect, it, vi } from "vitest";

vi.mock("./help.js", () => ({ handleHelp: vi.fn() }));
vi.mock("./session.js", () => ({
  handleNewSession: vi.fn(),
  handleSessions: vi.fn(),
}));
vi.mock("./model.js", () => ({ handleModel: vi.fn() }));
vi.mock("./memory.js", () => ({ handleMemory: vi.fn() }));
vi.mock("./log.js", () => ({ handleLogLevel: vi.fn() }));
vi.mock("./soul.js", () => ({ handleSoul: vi.fn() }));
vi.mock("./restart.js", () => ({ handleRestart: vi.fn() }));
vi.mock("./status.js", () => ({ handleStatus: vi.fn() }));
vi.mock("./audit.js", () => ({ handleAudit: vi.fn() }));
vi.mock("./cost.js", () => ({ handleCost: vi.fn() }));

import { registerCommands } from "./index.js";
import { getTelegramCommands } from "./definitions.js";

describe("registerCommands", () => {
  it("publishes Telegram command metadata and registers each handler", async () => {
    const setMyCommands = vi.fn().mockResolvedValue(true);
    const command = vi.fn();

    await registerCommands({
      api: { setMyCommands },
      command,
    });

    expect(setMyCommands).toHaveBeenCalledWith(getTelegramCommands());
    expect(command.mock.calls.map(([name]) => name)).toEqual(
      getTelegramCommands().map(({ command: commandName }) => commandName),
    );
  });
});
