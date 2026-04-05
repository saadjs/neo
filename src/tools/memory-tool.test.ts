import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (_name: string, definition: unknown) => definition,
}));

const refreshSessionContext = vi.fn<any>();
vi.mock("../agent.js", () => ({
  refreshSessionContext,
}));

const completeAudit = vi.fn<any>();
const createAuditTimer = vi.fn<any>(() => ({ complete: completeAudit }));
vi.mock("../logging/audit.js", () => ({
  createAuditTimer,
}));

const saveSoul = vi.fn<any>();
const loadSoul = vi.fn<any>(() => "soul");
vi.mock("../memory/soul.js", () => ({
  saveSoul,
  loadSoul,
}));

const savePreferences = vi.fn<any>();
const loadPreferences = vi.fn<any>(() => "preferences");
const appendPreference = vi.fn<any>();
vi.mock("../memory/preferences.js", () => ({
  savePreferences,
  loadPreferences,
  appendPreference,
}));

const saveHuman = vi.fn<any>();
const appendHuman = vi.fn<any>();
const loadHuman = vi.fn<any>(() => "human");
vi.mock("../memory/human.js", () => ({
  saveHuman,
  appendHuman,
  loadHuman,
}));

const readDailyMemory = vi.fn<any>();
const appendDailyMemory = vi.fn<any>();
const listMemoryFiles = vi.fn<any>();
const searchMemory = vi.fn<any>();
vi.mock("../memory/daily.js", () => ({
  readDailyMemory,
  appendDailyMemory,
  listMemoryFiles,
  searchMemory,
}));

const getChannelConfig = vi.fn<any>();
const upsertChannelConfig = vi.fn<any>();
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
        channel: -100123,
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
        channel: -100123,
      },
      invocation(),
    )) as ToolResult;

    expect(result.resultType).toBe("failure");
    expect(result.textResultForLlm).toContain("human memory is global");
    expect(appendHuman).not.toHaveBeenCalled();
  });
});
