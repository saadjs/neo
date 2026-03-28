import { describe, expect, it, vi } from "vitest";

vi.mock("../agent.js", () => ({
  getModelForChat: () => "anthropic:claude-sonnet-4-5",
}));

vi.mock("../config.js", () => ({
  config: {
    github: {
      token: "token",
    },
  },
}));

import { buildUsageMessage } from "./usage";
import {
  fetchAnthropicUsage,
  fetchCopilotUsage,
  fetchOpenAiUsage,
  fetchProviderUsage,
  fetchVercelUsage,
  formatDuration,
  parseCopilotUsageSnapshot,
} from "./usage-core";

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

  it("returns a helpful error for unsupported copilot response shapes", async () => {
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

  it("fetches vercel credit usage", async () => {
    const result = await fetchVercelUsage(
      {
        key: "vercel",
        label: "vercel",
        type: "openai",
        baseUrl: "https://ai-gateway.vercel.sh/v1",
        bearerToken: "vercel-token",
      },
      {
        fetchFn: async (_input, init?: RequestInit) => {
          expect(init?.headers).toMatchObject({
            Authorization: "Bearer vercel-token",
          });

          return new Response(JSON.stringify({ balance: "95.50", total_used: "4.50" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    );

    expect(result).toEqual({
      providerKey: "vercel",
      label: "vercel",
      ok: true,
      snapshot: {
        kind: "vercel",
        usage: {
          balance: "95.50",
          totalUsed: "4.50",
        },
      },
    });
  });

  it("fetches anthropic usage with the configured API key", async () => {
    const result = await fetchAnthropicUsage(
      {
        key: "anthropic",
        label: "anthropic",
        type: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant-test",
      },
      {
        fetchFn: async (_input, init?: RequestInit) => {
          expect(init?.headers).toMatchObject({
            "x-api-key": "sk-ant-test",
            "anthropic-version": "2023-06-01",
          });

          return new Response(
            JSON.stringify({
              data: [
                {
                  starting_at: "2026-02-11T00:00:00.000Z",
                  ending_at: "2026-02-12T00:00:00.000Z",
                  results: [
                    {
                      requests: 2,
                      uncached_input_tokens: 1200,
                      cache_creation: {
                        ephemeral_1h_input_tokens: 100,
                        ephemeral_5m_input_tokens: 50,
                      },
                      cache_read_input_tokens: 400,
                      output_tokens: 300,
                      server_tool_use: { web_search_requests: 2 },
                    },
                  ],
                },
                {
                  starting_at: "2026-02-12T00:00:00.000Z",
                  ending_at: "2026-02-13T00:00:00.000Z",
                  results: [
                    {
                      requests: 1,
                      uncached_input_tokens: 800,
                      cache_creation_input_tokens: 25,
                      cache_read_input_tokens: 125,
                      output_tokens: 200,
                      server_tool_use: { web_search_requests: 1 },
                    },
                  ],
                },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        },
        nowMs: Date.parse("2026-03-13T00:00:00.000Z"),
      },
    );

    expect(result).toEqual({
      providerKey: "anthropic",
      label: "anthropic",
      ok: true,
      snapshot: {
        kind: "anthropic",
        usage: {
          inputTokens: 2700,
          outputTokens: 500,
          requestCount: 3,
          windowStart: "2026-02-11T00:00:00.000Z",
          windowEnd: "2026-02-13T00:00:00.000Z",
        },
      },
    });
  });

  it("omits anthropic request counts when the API does not return them", async () => {
    const result = await fetchAnthropicUsage(
      {
        key: "anthropic",
        label: "anthropic",
        type: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant-test",
      },
      {
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  starting_at: "2026-02-11T00:00:00.000Z",
                  ending_at: "2026-02-12T00:00:00.000Z",
                  results: [
                    {
                      uncached_input_tokens: 1200,
                      output_tokens: 300,
                      server_tool_use: { web_search_requests: 2 },
                    },
                  ],
                },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
      },
    );

    expect(result).toEqual({
      providerKey: "anthropic",
      label: "anthropic",
      ok: true,
      snapshot: {
        kind: "anthropic",
        usage: {
          inputTokens: 1200,
          outputTokens: 300,
          requestCount: null,
          windowStart: "2026-02-11T00:00:00.000Z",
          windowEnd: "2026-02-12T00:00:00.000Z",
        },
      },
    });
  });

  it("treats empty anthropic usage buckets as zero usage", async () => {
    const result = await fetchAnthropicUsage(
      {
        key: "anthropic",
        label: "anthropic",
        type: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant-test",
      },
      {
        fetchFn: async () =>
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        nowMs: Date.parse("2026-03-13T00:00:00.000Z"),
      },
    );

    expect(result).toEqual({
      providerKey: "anthropic",
      label: "anthropic",
      ok: true,
      snapshot: {
        kind: "anthropic",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          requestCount: 0,
          windowStart: "2026-02-11T00:00:00.000Z",
          windowEnd: "2026-03-13T00:00:00.000Z",
        },
      },
    });
  });

  it("returns unavailable when anthropic denies usage access", async () => {
    const result = await fetchAnthropicUsage(
      {
        key: "anthropic",
        label: "anthropic",
        type: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant-test",
      },
      {
        fetchFn: async () => new Response("forbidden", { status: 403 }),
      },
    );

    expect(result).toEqual({
      providerKey: "anthropic",
      label: "anthropic",
      ok: false,
      error: "HTTP 403",
    });
  });

  it("fetches openai usage with the configured API key", async () => {
    const result = await fetchOpenAiUsage(
      {
        key: "openai",
        label: "openai",
        type: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-openai-test",
      },
      {
        fetchFn: async (_input, init?: RequestInit) => {
          expect(init?.headers).toMatchObject({
            Authorization: "Bearer sk-openai-test",
          });

          return new Response(
            JSON.stringify({
              data: [
                {
                  start_time: 1_739_404_800,
                  end_time: 1_739_491_200,
                  results: [
                    {
                      input_tokens: 1000,
                      output_tokens: 250,
                      input_cached_tokens: 300,
                      input_uncached_tokens: 700,
                      output_text_tokens: 250,
                      num_model_requests: 4,
                    },
                    {
                      input_uncached_tokens: 500,
                      input_cached_audio_tokens: 25,
                      input_audio_tokens: 10,
                      input_cached_image_tokens: 15,
                      output_text_tokens: 100,
                      num_model_requests: 2,
                    },
                  ],
                },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        },
      },
    );

    expect(result).toEqual({
      providerKey: "openai",
      label: "openai",
      ok: true,
      snapshot: {
        kind: "openai",
        usage: {
          inputTokens: 1550,
          outputTokens: 350,
          requestCount: 6,
          windowStart: "2025-02-13T00:00:00.000Z",
          windowEnd: "2025-02-14T00:00:00.000Z",
        },
      },
    });
  });

  it("does not double count openai cached token breakdowns when totals are present", async () => {
    const result = await fetchOpenAiUsage(
      {
        key: "openai",
        label: "openai",
        type: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-openai-test",
      },
      {
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  start_time: 1_739_404_800,
                  end_time: 1_739_491_200,
                  results: [
                    {
                      input_tokens: 52677,
                      output_tokens: 143,
                      input_cached_tokens: 25344,
                      input_uncached_tokens: 27333,
                      input_audio_tokens: 0,
                      input_cached_audio_tokens: 0,
                      input_image_tokens: 0,
                      input_cached_image_tokens: 0,
                      output_text_tokens: 143,
                      num_model_requests: 8,
                    },
                  ],
                },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
      },
    );

    expect(result).toEqual({
      providerKey: "openai",
      label: "openai",
      ok: true,
      snapshot: {
        kind: "openai",
        usage: {
          inputTokens: 52677,
          outputTokens: 143,
          requestCount: 8,
          windowStart: "2025-02-13T00:00:00.000Z",
          windowEnd: "2025-02-14T00:00:00.000Z",
        },
      },
    });
  });

  it("returns unavailable when openai denies usage access", async () => {
    const result = await fetchOpenAiUsage(
      {
        key: "openai",
        label: "openai",
        type: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-openai-test",
      },
      {
        fetchFn: async () => new Response("forbidden", { status: 403 }),
      },
    );

    expect(result).toEqual({
      providerKey: "openai",
      label: "openai",
      ok: false,
      error: "HTTP 403",
    });
  });

  it("treats empty openai usage buckets as zero usage", async () => {
    const result = await fetchOpenAiUsage(
      {
        key: "openai",
        label: "openai",
        type: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-openai-test",
      },
      {
        fetchFn: async () =>
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        nowMs: Date.parse("2026-03-13T00:00:00.000Z"),
      },
    );

    expect(result).toEqual({
      providerKey: "openai",
      label: "openai",
      ok: true,
      snapshot: {
        kind: "openai",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          requestCount: 0,
          windowStart: "2026-02-11T00:00:00.000Z",
          windowEnd: "2026-03-13T00:00:00.000Z",
        },
      },
    });
  });

  it("marks unsupported custom providers as unavailable", async () => {
    const result = await fetchProviderUsage({
      key: "ollama",
      label: "ollama",
      type: "openai",
      baseUrl: "http://localhost:11434/v1",
    });

    expect(result).toEqual({
      providerKey: "ollama",
      label: "ollama",
      ok: false,
      error: "usage API not supported",
    });
  });

  it("builds a Telegram-friendly multi-provider usage message", () => {
    expect(
      buildUsageMessage("anthropic:claude-sonnet-4-5", "anthropic", [
        {
          providerKey: "copilot",
          label: "GitHub Copilot",
          ok: true,
          snapshot: {
            kind: "copilot",
            usage: {
              premiumInteractions: {
                percentRemaining: 40,
                remaining: -12,
                entitlement: 1000,
              },
              chat: {
                percentRemaining: 100,
                remaining: 0,
                entitlement: 0,
              },
              resetsIn: "19 days",
              resetAt: "2026-04-01T00:00:00.000Z",
              plan: "individual",
            },
          },
        },
        {
          providerKey: "anthropic",
          label: "anthropic",
          ok: true,
          snapshot: {
            kind: "anthropic",
            usage: {
              inputTokens: 2000,
              outputTokens: 500,
              requestCount: null,
              windowStart: "2026-02-11T00:00:00.000Z",
              windowEnd: "2026-02-13T00:00:00.000Z",
            },
          },
        },
        {
          providerKey: "openai",
          label: "openai",
          ok: false,
          error: "HTTP 403",
        },
      ]),
    ).toBe(
      "📈 Usage\n\nCurrent model: anthropic:claude-sonnet-4-5\nCurrent provider: anthropic\n\nGitHub Copilot\nPlan: individual\nPremium interactions: 0 / 1000 remaining (40%)\nChat: 100% remaining\nResets in: 19 days\nReset time: Mar 31, 8:00 PM ET (Apr 1, 12:00 AM UTC)\n\nAnthropic\nInput tokens: 2,000\nOutput tokens: 500\nWindow: Feb 11 to Feb 12 UTC\n\nOpenAI\nUnavailable: organization usage endpoint is not accessible with the configured OpenAI key",
    );
  });

  it("formats vercel balances to cents", () => {
    expect(
      buildUsageMessage("vercel:openai/gpt-5.4", "vercel", [
        {
          providerKey: "vercel",
          label: "vercel",
          ok: true,
          snapshot: {
            kind: "vercel",
            usage: {
              balance: "4.90040643",
              totalUsed: "4.795664505",
            },
          },
        },
      ]),
    ).toContain("Balance: $4.90");
  });

  it("renders anthropic auth failures as human-readable guidance", () => {
    expect(
      buildUsageMessage("anthropic:claude-sonnet-4-5", "anthropic", [
        {
          providerKey: "anthropic",
          label: "anthropic",
          ok: false,
          error: "HTTP 401",
        },
      ]),
    ).toContain("Unavailable: usage API rejected the configured Anthropic key");
  });
});
