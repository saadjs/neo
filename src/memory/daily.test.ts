/* eslint-disable vitest/require-mock-type-parameters */
import { afterEach, describe, expect, it, vi } from "vitest";

const { readdirMock, mkdirMock } = vi.hoisted(() => ({
  readdirMock: vi.fn(),
  mkdirMock: vi.fn(),
}));

vi.mock("../config.js", () => ({
  config: {
    paths: {
      memoryDir: "/tmp/neo-memory-test",
    },
    telegram: {
      ownerId: 1,
    },
  },
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    mkdir: mkdirMock,
    readdir: readdirMock,
  };
});

import { isChannelChat, listMemoryFiles } from "./daily";

describe("daily memory helpers", () => {
  afterEach(() => {
    mkdirMock.mockReset();
    readdirMock.mockReset();
  });

  it("treats only negative Telegram chat IDs as channel chats", () => {
    expect(isChannelChat(1)).toBe(false);
    expect(isChannelChat(42)).toBe(false);
    expect(isChannelChat(-100123)).toBe(true);
  });

  it("excludes channel-scoped files from unscoped listings", async () => {
    readdirMock.mockResolvedValue([
      "MEMORY-2026-03-13.md",
      "MEMORY-SUMMARY-2026-W10.md",
      "MEMORY--100123-2026-03-13.md",
      "MEMORY-SUMMARY-ch-100123-2026-W10.md",
      "MEMORY-42-2026-03-13.md",
      "notes.md",
    ]);

    await expect(listMemoryFiles()).resolves.toEqual([
      "MEMORY-2026-03-13.md",
      "MEMORY-SUMMARY-2026-W10.md",
    ]);
  });

  it("returns only files for the requested channel when scoped", async () => {
    readdirMock.mockResolvedValue([
      "MEMORY-2026-03-13.md",
      "MEMORY--100123-2026-03-13.md",
      "MEMORY-SUMMARY-2026-W10.md",
      "MEMORY-SUMMARY-ch-100123-2026-W10.md",
      "MEMORY--100999-2026-03-13.md",
      "MEMORY-SUMMARY-ch-100999-2026-W10.md",
    ]);

    await expect(listMemoryFiles(-100123)).resolves.toEqual([
      "MEMORY--100123-2026-03-13.md",
      "MEMORY-SUMMARY-ch-100123-2026-W10.md",
    ]);
  });
});
