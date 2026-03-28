import { afterEach, describe, expect, it, vi } from "vitest";

const { configMock } = vi.hoisted(() => ({
  configMock: {
    providers: {
      anthropicApiKey: undefined as string | undefined,
      openaiApiKey: undefined as string | undefined,
      vercelAiGatewayApiKey: undefined as string | undefined,
      custom: {
        name: undefined as string | undefined,
        type: undefined as "openai" | "anthropic" | undefined,
        baseUrl: undefined as string | undefined,
        apiKey: undefined as string | undefined,
        bearerToken: undefined as string | undefined,
      },
    },
  },
}));

vi.mock("./config.js", () => ({
  config: configMock,
}));

vi.mock("./logging/index.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

afterEach(() => {
  vi.resetModules();
  configMock.providers.anthropicApiKey = undefined;
  configMock.providers.openaiApiKey = undefined;
  configMock.providers.vercelAiGatewayApiKey = undefined;
  configMock.providers.custom.name = undefined;
  configMock.providers.custom.type = undefined;
  configMock.providers.custom.baseUrl = undefined;
  configMock.providers.custom.apiKey = undefined;
  configMock.providers.custom.bearerToken = undefined;
});

describe("detectProviders", () => {
  it("returns empty when no provider keys are configured", async () => {
    const { detectProviders } = await import("./providers");
    expect(detectProviders()).toEqual([]);
  });

  it("detects Anthropic from API key", async () => {
    configMock.providers.anthropicApiKey = "sk-ant-test";
    const { detectProviders } = await import("./providers");
    const providers = detectProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0]).toEqual({
      key: "anthropic",
      label: "anthropic",
      type: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
    });
  });

  it("detects OpenAI from API key", async () => {
    configMock.providers.openaiApiKey = "sk-test";
    const { detectProviders } = await import("./providers");
    const providers = detectProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0]).toEqual({
      key: "openai",
      label: "openai",
      type: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    });
  });

  it("detects custom provider from base URL", async () => {
    configMock.providers.custom.name = "ollama";
    configMock.providers.custom.type = "openai";
    configMock.providers.custom.baseUrl = "http://localhost:11434/v1";
    const { detectProviders } = await import("./providers");
    const providers = detectProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0]).toEqual({
      key: "ollama",
      label: "ollama",
      type: "openai",
      baseUrl: "http://localhost:11434/v1",
      apiKey: undefined,
      bearerToken: undefined,
    });
  });

  it("detects Vercel AI Gateway from API key", async () => {
    configMock.providers.vercelAiGatewayApiKey = "vercel-token";
    const { detectProviders } = await import("./providers");
    const providers = detectProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0]).toEqual({
      key: "vercel",
      label: "vercel",
      type: "openai",
      baseUrl: "https://ai-gateway.vercel.sh/v1",
      bearerToken: "vercel-token",
    });
  });

  it("detects multiple providers simultaneously", async () => {
    configMock.providers.anthropicApiKey = "sk-ant-test";
    configMock.providers.openaiApiKey = "sk-test";
    const { detectProviders } = await import("./providers");

    expect(detectProviders()).toHaveLength(2);
  });
});

describe("parseQualifiedModel", () => {
  it("parses a plain model ID as copilot", async () => {
    const { parseQualifiedModel } = await import("./providers");
    expect(parseQualifiedModel("gpt-4.1")).toEqual({
      rawModel: "gpt-4.1",
      providerKey: undefined,
    });
  });

  it("parses a qualified model ID", async () => {
    configMock.providers.anthropicApiKey = "sk-ant-test";
    const { parseQualifiedModel, resetProviderCache } = await import("./providers");
    resetProviderCache();

    expect(parseQualifiedModel("anthropic:claude-opus-4-6")).toEqual({
      rawModel: "claude-opus-4-6",
      providerKey: "anthropic",
    });
  });

  it("treats unknown prefix as part of model ID", async () => {
    const { parseQualifiedModel } = await import("./providers");
    expect(parseQualifiedModel("unknown:some-model")).toEqual({
      rawModel: "unknown:some-model",
      providerKey: undefined,
    });
  });
});

describe("qualifyModel", () => {
  it("returns plain model ID when no provider", async () => {
    const { qualifyModel } = await import("./providers");
    expect(qualifyModel(undefined, "gpt-4.1")).toBe("gpt-4.1");
  });

  it("qualifies model with provider prefix", async () => {
    const { qualifyModel } = await import("./providers");
    expect(qualifyModel("anthropic", "claude-opus-4-6")).toBe("anthropic:claude-opus-4-6");
  });
});

describe("buildProviderConfig", () => {
  it("returns undefined for unknown provider", async () => {
    const { buildProviderConfig } = await import("./providers");
    expect(buildProviderConfig("nonexistent")).toBeUndefined();
  });

  it("builds provider config for Anthropic", async () => {
    configMock.providers.anthropicApiKey = "sk-ant-test";
    const { buildProviderConfig, resetProviderCache } = await import("./providers");
    resetProviderCache();
    const providerConfig = buildProviderConfig("anthropic");

    expect(providerConfig).toEqual({
      type: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
    });
  });

  it("includes bearer token when configured", async () => {
    configMock.providers.custom.name = "custom";
    configMock.providers.custom.type = "openai";
    configMock.providers.custom.baseUrl = "http://localhost:8080";
    configMock.providers.custom.bearerToken = "my-token";
    const { buildProviderConfig, resetProviderCache } = await import("./providers");
    resetProviderCache();
    const providerConfig = buildProviderConfig("custom");

    expect(providerConfig).toEqual({
      type: "openai",
      baseUrl: "http://localhost:8080",
      bearerToken: "my-token",
    });
  });

  it("builds provider config for Vercel AI Gateway", async () => {
    configMock.providers.vercelAiGatewayApiKey = "vercel-token";
    const { buildProviderConfig, resetProviderCache } = await import("./providers");
    resetProviderCache();
    const providerConfig = buildProviderConfig("vercel");

    expect(providerConfig).toEqual({
      type: "openai",
      baseUrl: "https://ai-gateway.vercel.sh/v1",
      bearerToken: "vercel-token",
    });
  });
});

describe("fetchProviderModels", () => {
  it("fetches Anthropic models", async () => {
    const mockResponse = {
      data: [
        { id: "claude-opus-4-6", display_name: "Claude Opus 4.6" },
        { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }),
    );

    const { fetchProviderModels } = await import("./providers");
    const models = await fetchProviderModels({
      key: "anthropic",
      label: "anthropic",
      type: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
    });

    expect(models).toEqual([
      { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    ]);

    vi.unstubAllGlobals();
  });

  it("sends bearer auth for Anthropics-compatible custom providers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" }],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchProviderModels } = await import("./providers");
    await fetchProviderModels({
      key: "custom-anthropic",
      label: "custom-anthropic",
      type: "anthropic",
      baseUrl: "https://anthropic-proxy.example.com",
      bearerToken: "my-bearer-token",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://anthropic-proxy.example.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "anthropic-version": "2023-06-01",
          Authorization: "Bearer my-bearer-token",
        }),
      }),
    );
    const requestInit = fetchMock.mock.calls[0]?.[1] as
      | { headers?: Record<string, string> }
      | undefined;
    expect(requestInit?.headers).not.toHaveProperty("x-api-key");

    vi.unstubAllGlobals();
  });

  it("fetches and filters OpenAI models", async () => {
    const mockResponse = {
      data: [
        { id: "gpt-4.1" },
        { id: "gpt-4.1-mini" },
        { id: "dall-e-3" },
        { id: "text-embedding-3-large" },
        { id: "o3-mini" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }),
    );

    const { fetchProviderModels } = await import("./providers");
    const models = await fetchProviderModels({
      key: "openai",
      label: "openai",
      type: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    });

    expect(models.map((m) => m.id)).toEqual(["gpt-4.1", "gpt-4.1-mini", "o3-mini"]);

    vi.unstubAllGlobals();
  });

  it("returns all models for custom OpenAI-compatible providers", async () => {
    const mockResponse = {
      data: [{ id: "llama3" }, { id: "codellama" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }),
    );

    const { fetchProviderModels } = await import("./providers");
    const models = await fetchProviderModels({
      key: "ollama",
      label: "ollama",
      type: "openai",
      baseUrl: "http://localhost:11434/v1",
    });

    expect(models).toEqual([
      { id: "llama3", name: "llama3" },
      { id: "codellama", name: "codellama" },
    ]);

    vi.unstubAllGlobals();
  });

  it("fetches only language models for Vercel AI Gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: "anthropic/claude-sonnet-4.5",
              name: "Claude Sonnet 4.5",
              type: "language",
            },
            {
              id: "openai/text-embedding-3-large",
              name: "text-embedding-3-large",
              type: "embedding",
            },
            {
              id: "openai/gpt-4.1-mini",
              type: "language",
            },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchProviderModels } = await import("./providers");
    const models = await fetchProviderModels({
      key: "vercel",
      label: "vercel",
      type: "openai",
      baseUrl: "https://ai-gateway.vercel.sh/v1",
      bearerToken: "vercel-token",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ai-gateway.vercel.sh/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer vercel-token",
        }),
      }),
    );
    expect(models).toEqual([
      {
        id: "anthropic/claude-sonnet-4.5",
        name: "Claude Sonnet 4.5",
      },
      {
        id: "openai/gpt-4.1-mini",
        name: "openai/gpt-4.1-mini",
      },
    ]);

    vi.unstubAllGlobals();
  });

  it("returns empty array on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      }),
    );

    const { fetchProviderModels } = await import("./providers");
    const models = await fetchProviderModels({
      key: "anthropic",
      label: "anthropic",
      type: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "invalid",
    });

    expect(models).toEqual([]);

    vi.unstubAllGlobals();
  });
});
