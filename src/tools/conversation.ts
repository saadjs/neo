import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { searchMessages, getRecentHistory } from "../logging/conversations";
import { createAuditTimer } from "../logging/audit";

export const conversationTool = defineTool("conversation", {
  description:
    "Search past conversation history or retrieve recent messages. Use 'search' to find messages by keyword, or 'history' to get recent messages for a chat.",
  parameters: z.object({
    action: z
      .enum(["search", "history"])
      .describe("'search' to find messages by keyword, 'history' to get recent messages"),
    query: z.string().optional().describe("Search query (required for search action)"),
    chat_id: z.number().optional().describe("Chat ID (required for history action)"),
    limit: z.number().optional().describe("Max results to return (default 20)"),
    offset: z.number().optional().describe("Offset for pagination (default 0, search only)"),
  }),
  handler: async (args, invocation) => {
    const audit = createAuditTimer(
      invocation.sessionId,
      "conversation",
      args as Record<string, unknown>,
    );

    try {
      const result = execute(args);
      audit.complete(result);
      return result;
    } catch (error) {
      const message = `conversation tool error: ${String(error)}`;
      audit.complete(message);
      return message;
    }
  },
});

function formatTimestamp(ts: string): string {
  return ts.replace("T", " ").slice(0, 16);
}

function execute(args: {
  action: "search" | "history";
  query?: string;
  chat_id?: number;
  limit?: number;
  offset?: number;
}): string {
  switch (args.action) {
    case "search": {
      if (!args.query) return "Error: query is required for search action.";

      const results = searchMessages(args.query, args.limit ?? 20, args.offset ?? 0);
      if (results.length === 0) return `No messages found matching "${args.query}".`;

      const lines = results.map(
        (r) => `[${formatTimestamp(r.created_at)}] (${r.role}) ${r.snippet}`,
      );
      return `Found ${results.length} result(s) for "${args.query}":\n${lines.join("\n")}`;
    }

    case "history": {
      if (args.chat_id == null) return "Error: chat_id is required for history action.";

      const messages = getRecentHistory(args.chat_id, args.limit ?? 20);
      if (messages.length === 0) return "No messages found for this chat.";

      // Reverse so oldest is first (query returns DESC order)
      const lines = messages
        .reverse()
        .map((m) => `[${formatTimestamp(m.created_at)}] (${m.role}) ${m.content}`);
      return `Last ${messages.length} message(s):\n${lines.join("\n")}`;
    }
  }
}
