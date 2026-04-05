import { afterEach, describe, expect, it, vi } from "vitest";

const {
  loadSoulMock,
  loadPreferencesMock,
  loadHumanMock,
  loadRecentSummariesMock,
  getChannelConfigMock,
  isChannelChatMock,
} = vi.hoisted(() => ({
  loadSoulMock: vi.fn<any>(),
  loadPreferencesMock: vi.fn<any>(),
  loadHumanMock: vi.fn<any>(),
  loadRecentSummariesMock: vi.fn<any>(),
  getChannelConfigMock: vi.fn<any>(),
  isChannelChatMock: vi.fn<any>(),
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

describe("buildSystemContextParts", () => {
  it("separates identity from additional content", async () => {
    loadSoulMock.mockResolvedValue("# Neo Soul");
    loadPreferencesMock.mockResolvedValue("# Preferences\n- be concise");
    loadHumanMock.mockResolvedValue("# Human\n- Name: Kevin");
    loadRecentSummariesMock.mockResolvedValue("");
    isChannelChatMock.mockReturnValue(false);

    const { buildSystemContextParts } = await import("./index");
    const parts = await buildSystemContextParts(123);

    expect(parts.identity).toBe("# Neo Soul");
    expect(parts.additionalContent).toContain("About the Human");
    expect(parts.additionalContent).toContain("User Preferences");
    expect(parts.additionalContent).toContain("Timezone");
    expect(parts.identity).not.toContain("Timezone");
    expect(parts.identity).not.toContain("About the Human");
  });

  it("includes channel soul overlay in identity", async () => {
    loadSoulMock.mockResolvedValue("# Neo Soul");
    loadPreferencesMock.mockResolvedValue("# Preferences");
    loadHumanMock.mockResolvedValue("# Human");
    loadRecentSummariesMock.mockResolvedValue("");
    isChannelChatMock.mockReturnValue(true);
    getChannelConfigMock.mockReturnValue({
      chatId: -100456,
      label: "dev",
      soulOverlay: "You are extra snarky here.",
      preferences: "Channel pref",
      topics: "coding",
    });

    const { buildSystemContextParts } = await import("./index");
    const parts = await buildSystemContextParts(-100456);

    expect(parts.identity).toContain("# Neo Soul");
    expect(parts.identity).toContain("Channel Persona");
    expect(parts.identity).toContain("extra snarky");
    expect(parts.additionalContent).toContain("Channel Preferences");
    expect(parts.additionalContent).toContain("Topic Enforcement");
    expect(parts.additionalContent).toContain("Current Channel");
  });

  it("produces equivalent output when reassembled via buildSystemContext", async () => {
    loadSoulMock.mockResolvedValue("Soul");
    loadPreferencesMock.mockResolvedValue("- pref");
    loadHumanMock.mockResolvedValue("- human");
    loadRecentSummariesMock.mockResolvedValue("");
    isChannelChatMock.mockReturnValue(false);

    const { buildSystemContext, buildSystemContextParts } = await import("./index");
    const flat = await buildSystemContext(99);

    // Reset mocks so the second call gets the same data
    loadSoulMock.mockResolvedValue("Soul");
    loadPreferencesMock.mockResolvedValue("- pref");
    loadHumanMock.mockResolvedValue("- human");
    loadRecentSummariesMock.mockResolvedValue("");

    const parts = await buildSystemContextParts(99);
    const reassembled = `${parts.identity}\n\n---\n\n${parts.additionalContent}`;

    expect(reassembled).toBe(flat);
  });
});
