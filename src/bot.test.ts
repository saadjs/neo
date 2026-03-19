import { afterEach, describe, expect, it, vi } from "vitest";

const { startMock, apiMock, runnerMock, setTelegramTransportMock } = vi.hoisted(() => ({
  apiMock: { sendMessage: vi.fn() },
  runnerMock: { stop: vi.fn() },
  setTelegramTransportMock: vi.fn(),
  startMock: vi.fn(),
}));

vi.mock("./transport/telegram.js", () => ({
  TelegramTransport: class MockTelegramTransport {
    api = apiMock;
    start = startMock;
  },
}));

vi.mock("./telegram/runtime.js", () => ({
  setTelegramTransport: setTelegramTransportMock,
}));

afterEach(() => {
  startMock.mockReset();
  setTelegramTransportMock.mockReset();
  vi.resetModules();
});

describe("createBot", () => {
  it("creates and starts the Telegram transport adapter", async () => {
    startMock.mockResolvedValue({
      transport: { api: apiMock },
      api: apiMock,
      runner: runnerMock,
    });

    const { createBot } = await import("./bot");
    const handle = await createBot();

    expect(setTelegramTransportMock).toHaveBeenCalledTimes(1);
    expect(setTelegramTransportMock.mock.invocationCallOrder[0]).toBeLessThan(
      startMock.mock.invocationCallOrder[0],
    );
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(handle).toEqual({
      transport: expect.any(Object),
      api: apiMock,
      runner: runnerMock,
    });
  });
});
