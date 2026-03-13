import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { loadSoul, saveSoul } from "../memory/soul.js";
import {
  loadPreferences,
  savePreferences,
  appendPreference,
} from "../memory/preferences.js";
import {
  readDailyMemory,
  appendDailyMemory,
  listMemoryFiles,
  searchMemory,
} from "../memory/daily.js";
import { createAuditTimer } from "../logging/audit.js";

const parameters = z.object({
  operation: z.enum(["read", "write", "append", "search", "list"]),
  target: z.enum(["soul", "preferences", "daily"]),
  content: z
    .string()
    .optional()
    .describe("Content to write or append (required for write/append)"),
  query: z
    .string()
    .optional()
    .describe("Search query (required for search operation)"),
  date: z
    .string()
    .optional()
    .describe("Date in yyyy-mm-dd format for reading a specific daily memory"),
});

export const memoryTool = defineTool("memory", {
  description:
    "Read, write, append, search, or list Neo's memory files (soul, preferences, daily).",
  parameters,
  handler: async (args, invocation) => {
    const timer = createAuditTimer(invocation.sessionId, "memory", {
      operation: args.operation,
      target: args.target,
    });

    try {
      const result = await execute(args);
      timer.complete(result.slice(0, 500));
      return { textResultForLlm: result, resultType: "success" as const };
    } catch (error) {
      const message = `memory tool error: ${String(error)}`;
      timer.complete(message);
      return {
        textResultForLlm: message,
        resultType: "failure" as const,
        error: String(error),
      };
    }
  },
});

async function execute(args: z.infer<typeof parameters>): Promise<string> {
  const { operation, target, content, query, date } = args;

  switch (operation) {
    case "read":
      return readTarget(target, date);

    case "write": {
      if (!content) throw new Error("content is required for write operation");
      return writeTarget(target, content);
    }

    case "append": {
      if (!content)
        throw new Error("content is required for append operation");
      if (target === "soul")
        throw new Error("append is not supported for soul — use write instead");
      return appendTarget(target, content);
    }

    case "search": {
      if (!query) throw new Error("query is required for search operation");
      return searchMemory(query);
    }

    case "list": {
      const files = await listMemoryFiles();
      return files.length > 0
        ? `Memory files:\n${files.join("\n")}`
        : "No memory files found.";
    }
  }
}

async function readTarget(
  target: "soul" | "preferences" | "daily",
  date?: string,
): Promise<string> {
  switch (target) {
    case "soul":
      return loadSoul();
    case "preferences":
      return loadPreferences();
    case "daily": {
      const memory = await readDailyMemory(date);
      return memory || "No memory found for this date.";
    }
  }
}

async function writeTarget(
  target: "soul" | "preferences" | "daily",
  content: string,
): Promise<string> {
  switch (target) {
    case "soul":
      await saveSoul(content);
      return "Soul updated.";
    case "preferences":
      await savePreferences(content);
      return "Preferences updated.";
    case "daily":
      await appendDailyMemory(content);
      return "Daily memory written.";
  }
}

async function appendTarget(
  target: "preferences" | "daily",
  content: string,
): Promise<string> {
  switch (target) {
    case "preferences":
      await appendPreference(content);
      return "Preference appended.";
    case "daily":
      await appendDailyMemory(content);
      return "Daily memory appended.";
  }
}
