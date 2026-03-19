import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (_name: string, definition: unknown) => definition,
}));

const refreshSessionContext = vi.fn();
vi.mock("../agent.js", () => ({
  refreshSessionContext,
}));

const completeAudit = vi.fn();
const createAuditTimer = vi.fn(() => ({ complete: completeAudit }));
vi.mock("../logging/audit.js", () => ({
  createAuditTimer,
}));

const saveSoul = vi.fn();
const loadSoul = vi.fn(() => "soul");
vi.mock("../memory/soul.js", () => ({
  saveSoul,
  loadSoul,
}));

const savePreferences = vi.fn();
const loadPreferences = vi.fn(() => "preferences");
const appendPreference = vi.fn();
vi.mock("../memory/preferences.js", () => ({
  savePreferences,
  loadPreferences,
  appendPreference,
}));

const saveHuman = vi.fn();
const appendHuman = vi.fn();
const loadHuman = vi.fn(() => "human");
vi.mock("../memory/human.js", () => ({
  saveHuman,
  appendHuman,
  loadHuman,
}));

const readDailyMemory = vi.fn();
const appendDailyMemory = vi.fn();
const listMemoryFiles = vi.fn();
const searchMemory = vi.fn();
vi.mock("../memory/daily.js", () => ({
  readDailyMemory,
  appendDailyMemory,
  listMemoryFiles,
  searchMemory,
}));

const getChannelConfig = vi.fn();
const upsertChannelConfig = vi.fn();
vi.mock("../memory/db.js", () => ({
  getChannelConfig,
  upsertChannelConfig,
}));

function invocation() {
  return {
    sessionId: "session-1",
    toolCallId: "tool-call-1",
    toolName: "memory",
    arguments: {},
  };
}

interface ToolResult {
  resultType: string;
  textResultForLlm: string;
}

describe("memoryTool", () => {
  beforeEach(() => {
    vi.resetModules();
    refreshSessionContext.mockReset();
    completeAudit.mockReset();
    createAuditTimer.mockClear();
    saveSoul.mockReset();
    savePreferences.mockReset();
    appendPreference.mockReset();
    saveHuman.mockReset();
    appendHuman.mockReset();
    readDailyMemory.mockReset();
    appendDailyMemory.mockReset();
    listMemoryFiles.mockReset();
    searchMemory.mockReset();
    getChannelConfig.mockReset();
    upsertChannelConfig.mockReset();
  });

  it("rejects channel-scoped human writes", async () => {
    const { memoryTool } = await import("./memory-tool");
    const result = (await memoryTool.handler(
      {
        operation: "write",
        target: "human",
        content: "User likes sci-fi",
        channel: "-100123",
      },
      invocation(),
    )) as ToolResult;

    expect(result.resultType).toBe("failure");
    expect(result.textResultForLlm).toContain("human memory is global");
    expect(saveHuman).not.toHaveBeenCalled();
  });

  it("rejects channel-scoped human appends", async () => {
    const { memoryTool } = await import("./memory-tool");
    const result = (await memoryTool.handler(
      {
        operation: "append",
        target: "human",
        content: "User likes sci-fi",
        channel: "-100123",
      },
      invocation(),
    )) as ToolResult;

    expect(result.resultType).toBe("failure");
    expect(result.textResultForLlm).toContain("human memory is global");
    expect(appendHuman).not.toHaveBeenCalled();
  });
});
