import { afterEach, describe, expect, it, vi } from "vitest";

const { abortSessionMock } = vi.hoisted(() => ({
  abortSessionMock: vi.fn(),
}));

vi.mock("../agent.js", () => ({
  abortSession: abortSessionMock,
}));

vi.mock("../logging/index.js", () => ({
  getLogger: () => ({ info: vi.fn() }),
}));

import { handleCancel } from "./cancel.js";

afterEach(() => {
  abortSessionMock.mockReset();
});

function makeCtx(chatId: number) {
  return { chat: { id: chatId }, reply: vi.fn() } as unknown as Parameters<typeof handleCancel>[0];
}

describe("handleCancel", () => {
  it("aborts an active turn and replies with confirmation", async () => {
    abortSessionMock.mockResolvedValue("aborted");
    const ctx = makeCtx(42);

    await handleCancel(ctx);

    expect(abortSessionMock).toHaveBeenCalledWith(42);
    expect(ctx.reply).toHaveBeenCalledWith("Cancelled.");
  });

  it("replies with no-session message when no session exists", async () => {
    abortSessionMock.mockResolvedValue("no-session");
    const ctx = makeCtx(42);

    await handleCancel(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("No active session.");
  });

  it("replies with nothing-running message when no turn is active", async () => {
    abortSessionMock.mockResolvedValue("no-active-turn");
    const ctx = makeCtx(42);

    await handleCancel(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("Nothing is running right now.");
  });
});
