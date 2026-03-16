import { describe, expect, it, vi } from "vitest";

vi.mock("../agent.js", () => ({
  getModelForChat: () => "gpt-4.1",
}));

vi.mock("../config.js", () => ({
  config: {
    github: {
      token: "token",
    },
  },
}));

import { buildUsageMessage } from "./usage";
import { fetchCopilotUsage, formatDuration, parseCopilotUsageSnapshot } from "./usage-core";

describe("usage-core", () => {
  it("formats reset countdowns", () => {
    expect(formatDuration(0)).toBe("now");
    expect(formatDuration(61)).toBe("1 minute");
    expect(formatDuration(3660)).toBe("1 hour 1 minute");
    expect(formatDuration(86_400 * 18)).toBe("18 days");
    expect(formatDuration(86_400 * 18 + 4 * 60)).toBe("18 days 4 minutes");
    expect(formatDuration(30)).toBe("<1 minute");
  });

  it("parses copilot quota snapshots with direct percentages", () => {
    const usage = parseCopilotUsageSnapshot(
      {
        quota_snapshots: {
          premium_interactions: { percent_remaining: 80 },
          chat: { percent_remaining: 65 },
        },
        quota_reset_date: "2026-03-20T00:00:00.000Z",
        copilot_plan: "individual",
      },
      Date.parse("2026-03-13T00:00:00.000Z"),
    );

    expect(usage).toEqual({
      premiumInteractions: {
        percentRemaining: 80,
        remaining: null,
        entitlement: null,
      },
      chat: {
        percentRemaining: 65,
        remaining: null,
        entitlement: null,
      },
      resetsIn: "7 days",
      resetAt: "2026-03-20T00:00:00.000Z",
      plan: "individual",
    });
  });

  it("parses copilot monthly fallback quotas", () => {
    const usage = parseCopilotUsageSnapshot(
      {
        monthly_quotas: { completions: 1000, chat: 500 },
        limited_user_quotas: { completions: 400, chat: 250 },
      },
      Date.parse("2026-03-13T00:00:00.000Z"),
    );

    expect(usage).toEqual({
      premiumInteractions: {
        percentRemaining: 40,
        remaining: 400,
        entitlement: 1000,
      },
      chat: {
        percentRemaining: 50,
        remaining: 250,
        entitlement: 500,
      },
      resetsIn: "19 days",
      resetAt: "2026-04-01T00:00:00.000Z",
      plan: null,
    });
  });

  it("returns a helpful error for unsupported response shapes", async () => {
    const result = await fetchCopilotUsage("token", {
      fetchFn: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      nowMs: Date.parse("2026-03-13T00:00:00.000Z"),
    });

    expect(result).toEqual({
      ok: false,
      error: "unrecognized response shape",
    });
  });

  it("uses bearer auth for the copilot internal endpoint", async () => {
    const fetchFn: typeof fetch = vi.fn(async (_input, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer token",
      });

      return new Response(
        JSON.stringify({
          quota_snapshots: {
            premium_interactions: { percent_remaining: 80 },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const result = await fetchCopilotUsage("token", {
      fetchFn,
      nowMs: Date.parse("2026-03-13T00:00:00.000Z"),
    });

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(result).toEqual({
      ok: true,
      usage: {
        premiumInteractions: {
          percentRemaining: 80,
          remaining: null,
          entitlement: null,
        },
        chat: null,
        resetsIn: "19 days",
        resetAt: "2026-04-01T00:00:00.000Z",
        plan: null,
      },
    });
  });

  it("builds a Telegram-friendly usage message", () => {
    expect(
      buildUsageMessage("gpt-4.1", {
        premiumInteractions: {
          percentRemaining: 40,
          remaining: 400,
          entitlement: 1000,
        },
        chat: {
          percentRemaining: 50,
          remaining: 250,
          entitlement: 500,
        },
        resetsIn: "19 days",
        resetAt: "2026-04-01T00:00:00.000Z",
        plan: "individual",
      }),
    ).toBe(
      "📈 Copilot Usage\n\nModel: gpt-4.1\nPlan: individual\n\nPremium interactions: 400 / 1000 remaining (40%)\nChat: 250 / 500 remaining (50%)\nResets in: 19 days\nReset time: Mar 31, 8:00 PM ET (Apr 1, 12:00 AM UTC)",
    );
  });
});
