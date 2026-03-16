import { afterEach, describe, expect, it, vi } from "vitest";

const {
  loadSoulMock,
  loadPreferencesMock,
  loadHumanMock,
  loadRecentSummariesMock,
  getChannelConfigMock,
  isChannelChatMock,
} = vi.hoisted(() => ({
  loadSoulMock: vi.fn(),
  loadPreferencesMock: vi.fn(),
  loadHumanMock: vi.fn(),
  loadRecentSummariesMock: vi.fn(),
  getChannelConfigMock: vi.fn(),
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
  isChannelChat: isChannelChatMock,
}));

vi.mock("./decay.js", () => ({
  loadRecentSummaries: loadRecentSummariesMock,
}));

vi.mock("./db.js", () => ({
  getChannelConfig: getChannelConfigMock,
}));

afterEach(() => {
  vi.resetModules();
  loadSoulMock.mockReset();
  loadPreferencesMock.mockReset();
  loadHumanMock.mockReset();
  loadRecentSummariesMock.mockReset();
  getChannelConfigMock.mockReset();
  isChannelChatMock.mockReset();
});

describe("buildSystemContext", () => {
  it("keeps the owner DM on the global memory namespace", async () => {
    loadSoulMock.mockResolvedValue("Soul");
    loadPreferencesMock.mockResolvedValue("- pref");
    loadHumanMock.mockResolvedValue("- human");
    loadRecentSummariesMock.mockResolvedValue("");
    isChannelChatMock.mockReturnValue(false);

    const { buildSystemContext } = await import("./index");
    const context = await buildSystemContext(123);

    expect(isChannelChatMock).toHaveBeenCalledWith(123);
    expect(getChannelConfigMock).not.toHaveBeenCalled();
    expect(context).not.toContain("## Current Channel");
    expect(context).not.toContain("channel: 123");
  });

  it("includes channel guidance for non-owner channel chats", async () => {
    loadSoulMock.mockResolvedValue("Soul");
    loadPreferencesMock.mockResolvedValue("- pref");
    loadHumanMock.mockResolvedValue("- human");
    loadRecentSummariesMock.mockResolvedValue("");
    isChannelChatMock.mockReturnValue(true);
    getChannelConfigMock.mockReturnValue({
      chatId: -100123,
      label: "platform",
      soulOverlay: null,
      preferences: null,
      topics: null,
    });

    const { buildSystemContext } = await import("./index");
    const context = await buildSystemContext(-100123);

    expect(getChannelConfigMock).toHaveBeenCalledWith(-100123);
    expect(context).toContain("## Current Channel");
    expect(context).toContain("channel: -100123");
  });

  it("does not include dynamic sections (moved to onSessionStart hook)", async () => {
    loadSoulMock.mockResolvedValue("Soul");
    loadPreferencesMock.mockResolvedValue("- pref");
    loadHumanMock.mockResolvedValue("- human");
    loadRecentSummariesMock.mockResolvedValue("");
    isChannelChatMock.mockReturnValue(false);

    const { buildSystemContext } = await import("./index");
    const context = await buildSystemContext(123);

    expect(context).not.toContain("Today's Memory");
    expect(context).not.toContain("Anomalies");
    expect(context).toContain("Soul");
    expect(context).toContain("Timezone");
  });
});
