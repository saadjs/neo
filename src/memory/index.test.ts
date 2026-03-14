import { afterEach, describe, expect, it, vi } from "vitest";

const {
  loadSoulMock,
  loadPreferencesMock,
  loadHumanMock,
  readDailyMemoryMock,
  loadRecentSummariesMock,
  getChannelConfigMock,
  getRuntimeContextSectionMock,
  formatAnomaliesForContextMock,
  isChannelChatMock,
} = vi.hoisted(() => ({
  loadSoulMock: vi.fn(),
  loadPreferencesMock: vi.fn(),
  loadHumanMock: vi.fn(),
  readDailyMemoryMock: vi.fn(),
  loadRecentSummariesMock: vi.fn(),
  getChannelConfigMock: vi.fn(),
  getRuntimeContextSectionMock: vi.fn(),
  formatAnomaliesForContextMock: vi.fn(),
  isChannelChatMock: vi.fn(),
}));

vi.mock("./soul.js", () => ({
  loadSoul: loadSoulMock,
}));

vi.mock("./preferences.js", () => ({
  loadPreferences: loadPreferencesMock,
}));

vi.mock("./human.js", () => ({
  loadHuman: loadHumanMock,
}));

vi.mock("./daily.js", () => ({
  readDailyMemory: readDailyMemoryMock,
  isChannelChat: isChannelChatMock,
}));

vi.mock("./decay.js", () => ({
  loadRecentSummaries: loadRecentSummariesMock,
}));

vi.mock("./db.js", () => ({
  getChannelConfig: getChannelConfigMock,
}));

vi.mock("../runtime/state.js", () => ({
  getRuntimeContextSection: getRuntimeContextSectionMock,
}));

vi.mock("../logging/anomalies.js", () => ({
  formatAnomaliesForContext: formatAnomaliesForContextMock,
}));

afterEach(() => {
  vi.resetModules();
  loadSoulMock.mockReset();
  loadPreferencesMock.mockReset();
  loadHumanMock.mockReset();
  readDailyMemoryMock.mockReset();
  loadRecentSummariesMock.mockReset();
  getChannelConfigMock.mockReset();
  getRuntimeContextSectionMock.mockReset();
  formatAnomaliesForContextMock.mockReset();
  isChannelChatMock.mockReset();
});

describe("buildSystemContext", () => {
  it("keeps the owner DM on the global memory namespace", async () => {
    loadSoulMock.mockResolvedValue("Soul");
    loadPreferencesMock.mockResolvedValue("- pref");
    loadHumanMock.mockResolvedValue("- human");
    readDailyMemoryMock.mockResolvedValue("# Memory");
    loadRecentSummariesMock.mockResolvedValue("");
    getRuntimeContextSectionMock.mockReturnValue("");
    formatAnomaliesForContextMock.mockReturnValue("");
    isChannelChatMock.mockReturnValue(false);

    const { buildSystemContext } = await import("./index.js");
    const context = await buildSystemContext(123);

    expect(isChannelChatMock).toHaveBeenCalledWith(123);
    expect(getChannelConfigMock).not.toHaveBeenCalled();
    expect(readDailyMemoryMock).toHaveBeenCalledTimes(1);
    expect(readDailyMemoryMock).toHaveBeenCalledWith();
    expect(context).not.toContain("## Current Channel");
    expect(context).not.toContain("channel: 123");
  });

  it("includes channel guidance for non-owner channel chats", async () => {
    loadSoulMock.mockResolvedValue("Soul");
    loadPreferencesMock.mockResolvedValue("- pref");
    loadHumanMock.mockResolvedValue("- human");
    readDailyMemoryMock.mockResolvedValue("");
    loadRecentSummariesMock.mockResolvedValue("");
    getRuntimeContextSectionMock.mockReturnValue("");
    formatAnomaliesForContextMock.mockReturnValue("");
    isChannelChatMock.mockReturnValue(true);
    getChannelConfigMock.mockReturnValue({
      chatId: -100123,
      label: "platform",
      soulOverlay: null,
      preferences: null,
      topics: null,
    });

    const { buildSystemContext } = await import("./index.js");
    const context = await buildSystemContext(-100123);

    expect(getChannelConfigMock).toHaveBeenCalledWith(-100123);
    expect(readDailyMemoryMock).toHaveBeenNthCalledWith(2, undefined, -100123);
    expect(context).toContain("## Current Channel");
    expect(context).toContain("channel: -100123");
  });
});
