import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { createAuditTimer } from "../logging/audit.js";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function parseResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const resultBlocks = html.split(/class="result\s/);

  for (let i = 1; i < resultBlocks.length; i++) {
    const block = resultBlocks[i];

    const titleMatch = block.match(/<a[^>]+class="result__a"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/);
    const urlMatch = block.match(/<a[^>]+class="result__url"[^>]*href="([^"]*)"[^>]*>/);
    const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

    const title = stripHtml(titleMatch?.[1] ?? "").trim();
    const rawUrl = urlMatch?.[1] ?? "";
    const snippet = stripHtml(snippetMatch?.[1] ?? "").trim();

    if (!title && !rawUrl) continue;

    const url = resolveUrl(rawUrl);
    results.push({ title, url, snippet });
  }

  return results;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

function resolveUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("http")) return trimmed;
  return trimmed;
}

function formatResults(results: SearchResult[], query: string): string {
  if (results.length === 0) {
    return `No results found for "${query}".`;
  }

  const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`);

  return `Search results for "${query}":\n\n${lines.join("\n\n")}`;
}

export const webSearchTool = defineTool("web_search", {
  description:
    "Search the web using DuckDuckGo and return titles, URLs, and snippets for the top results.",
  parameters: z.object({
    query: z.string().describe("The search query to look up on the web."),
    num_results: z
      .number()
      .optional()
      .default(5)
      .describe("Number of results to return (default 5)."),
  }),
  handler: async (args, invocation) => {
    const timer = createAuditTimer(invocation.sessionId, "web_search", {
      query: args.query,
      num_results: args.num_results,
    });

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Neo/1.0)",
        },
      });

      if (!response.ok) {
        const msg = `Search request failed with status ${response.status}`;
        timer.complete(msg);
        return msg;
      }

      const html = await response.text();
      const results = parseResults(html).slice(0, args.num_results);
      const formatted = formatResults(results, args.query);

      timer.complete(`ok: ${results.length} results`);
      return formatted;
    } catch (error) {
      const msg = `Web search failed: ${error instanceof Error ? error.message : String(error)}`;
      timer.complete(msg);
      return msg;
    }
  },
});
