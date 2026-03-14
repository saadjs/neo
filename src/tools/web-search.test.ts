import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (_name: string, definition: unknown) => definition,
}));

const completeAudit = vi.fn();

vi.mock("../logging/audit.js", () => ({
  createAuditTimer: vi.fn(() => ({ complete: completeAudit })),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function toolInvocation() {
  return {
    sessionId: "test-session",
    toolCallId: "tool-call-1",
    toolName: "web_search",
    arguments: {},
  };
}

describe("webSearchTool", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    completeAudit.mockReset();
  });

  it("formats top results from DuckDuckGo HTML", async () => {
    const html = `
      <div class="result results_links">
        <a class="result__a">Neo &amp; Search</a>
        <a class="result__url" href="//example.com/article"></a>
        <a class="result__snippet">Useful <b>snippet</b> here</a>
      </div>
      <div class="result results_links">
        <a class="result__a">Second result</a>
        <a class="result__url" href="https://example.org/post"></a>
        <a class="result__snippet">Another result</a>
      </div>
    `;
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => html,
    });

    const { webSearchTool } = await import("./web-search.js");
    const result = await webSearchTool.handler({ query: "neo", num_results: 1 }, toolInvocation());

    expect(fetchMock).toHaveBeenCalledWith(
      "https://html.duckduckgo.com/html/?q=neo",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": "Mozilla/5.0 (compatible; Neo/1.0)",
        }),
      }),
    );
    expect(result).toContain('Search results for "neo":');
    expect(result).toContain("1. Neo & Search");
    expect(result).toContain("https://example.com/article");
    expect(result).toContain("Useful snippet here");
    expect(result).not.toContain("Second result");
    expect(completeAudit).toHaveBeenCalledWith("ok: 1 results");
  });

  it("returns a helpful empty-state message", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '<html><body><div class="no-results"></div></body></html>',
    });

    const { webSearchTool } = await import("./web-search.js");
    const result = await webSearchTool.handler(
      { query: "missing", num_results: 5 },
      toolInvocation(),
    );

    expect(result).toBe('No results found for "missing".');
    expect(completeAudit).toHaveBeenCalledWith("ok: 0 results");
  });

  it("reports upstream HTTP failures", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
    });

    const { webSearchTool } = await import("./web-search.js");
    const result = await webSearchTool.handler({ query: "neo", num_results: 5 }, toolInvocation());

    expect(result).toBe("Search request failed with status 503");
    expect(completeAudit).toHaveBeenCalledWith("Search request failed with status 503");
  });

  it("catches fetch errors and returns a tool-friendly message", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const { webSearchTool } = await import("./web-search.js");
    const result = await webSearchTool.handler({ query: "neo", num_results: 5 }, toolInvocation());

    expect(result).toBe("Web search failed: network down");
    expect(completeAudit).toHaveBeenCalledWith("Web search failed: network down");
  });
});
