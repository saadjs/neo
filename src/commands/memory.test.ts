import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  isChannelChatMock,
  listMemoryFilesMock,
  loadPreferencesMock,
  readDailyMemoryMock,
  searchMemoryMock,
} = vi.hoisted(() => ({
  isChannelChatMock: vi.fn(),
  listMemoryFilesMock: vi.fn(),
  loadPreferencesMock: vi.fn(),
  readDailyMemoryMock: vi.fn(),
  searchMemoryMock: vi.fn(),
}));

vi.mock("../memory/index.js", () => ({
  isChannelChat: isChannelChatMock,
  listMemoryFiles: listMemoryFilesMock,
  loadPreferences: loadPreferencesMock,
  readDailyMemory: readDailyMemoryMock,
  searchMemory: searchMemoryMock,
}));

vi.mock("../logging/conversations.js", () => ({
  searchSessionsByTag: vi.fn(),
}));

import { handleMemory } from "./memory";

describe("handleMemory", () => {
  beforeEach(() => {
    isChannelChatMock.mockReset();
    listMemoryFilesMock.mockReset();
    loadPreferencesMock.mockReset();
    readDailyMemoryMock.mockReset();
    searchMemoryMock.mockReset();

    isChannelChatMock.mockImplementation((chatId: number) => chatId < 0);
    loadPreferencesMock.mockResolvedValue("# Preferences\n");
    listMemoryFilesMock.mockResolvedValue([]);
    readDailyMemoryMock.mockResolvedValue("");
    searchMemoryMock.mockResolvedValue("No matches found.");
  });

  it("reads the current channel namespace for memory overview and searches", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleMemory({
      chat: { id: -100123 },
      message: { text: "/memory" },
      reply,
    } as never);

    expect(listMemoryFilesMock).toHaveBeenCalledWith(-100123);
    expect(readDailyMemoryMock).toHaveBeenCalledWith(undefined, -100123);

    readDailyMemoryMock.mockClear();

    await handleMemory({
      chat: { id: -100123 },
      message: { text: "/memory recent 2" },
      reply,
    } as never);

    expect(readDailyMemoryMock).toHaveBeenCalledWith(expect.any(String), -100123);

    await handleMemory({
      chat: { id: -100123 },
      message: { text: "/memory deploy" },
      reply,
    } as never);

    expect(searchMemoryMock).toHaveBeenCalledWith("deploy", -100123);
  });

  it("keeps private chats on the global memory namespace", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleMemory({
      chat: { id: 42 },
      message: { text: "/memory" },
      reply,
    } as never);

    expect(listMemoryFilesMock).toHaveBeenCalledWith(undefined);
    expect(readDailyMemoryMock).toHaveBeenCalledWith(undefined, undefined);
  });
});
