import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { loadSoul, saveSoul } from "../memory/soul";
import { loadPreferences, savePreferences, appendPreference } from "../memory/preferences";
import { loadHuman, saveHuman, appendHuman } from "../memory/human";
import { readDailyMemory, appendDailyMemory, listMemoryFiles, searchMemory } from "../memory/daily";
import { getChannelConfig, upsertChannelConfig } from "../memory/db";
import { refreshSessionContext } from "../agent";
import { createAuditTimer } from "../logging/audit";

const parameters = z.object({
  operation: z.enum(["read", "write", "append", "search", "list"]),
  target: z.enum(["soul", "preferences", "human", "daily", "topics"]),
  content: z.string().optional().describe("Content to write or append (required for write/append)"),
  query: z.string().optional().describe("Search query (required for search operation)"),
  date: z
    .string()
    .optional()
    .describe("Date in yyyy-mm-dd format for reading a specific daily memory"),
  channel: z
    .number()
    .optional()
    .describe("Chat ID to scope operation to a specific channel. Omit for global scope."),
});

export const memoryTool = defineTool("memory", {
  description:
    "Read, write, append, search, or list Neo's memory files (soul, preferences, human, daily, topics). Use 'human' target to store and recall facts about the user. Pass 'channel' to scope operations to a specific channel chat.",
  parameters,
  handler: async (args, invocation) => {
    const timer = createAuditTimer(invocation.sessionId, "memory", {
      operation: args.operation,
      target: args.target,
      channel: args.channel,
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
  const { operation, target, content, query, date, channel } = args;

  switch (operation) {
    case "read":
      return readTarget(target, date, channel);

    case "write": {
      if (!content) throw new Error("content is required for write operation");
      return writeTarget(target, content, channel);
    }

    case "append": {
      if (!content) throw new Error("content is required for append operation");
      if (target === "soul" && !channel)
        throw new Error("append is not supported for soul — use write instead");
      if (target === "topics")
        throw new Error("append is not supported for topics — use write instead");
      return appendTarget(target, content, channel);
    }

    case "search": {
      if (!query) throw new Error("query is required for search operation");
      return searchMemory(query, channel);
    }

    case "list": {
      const files = await listMemoryFiles(channel);
      return files.length > 0 ? `Memory files:\n${files.join("\n")}` : "No memory files found.";
    }
  }
}

async function readTarget(
  target: "soul" | "preferences" | "human" | "daily" | "topics",
  date?: string,
  channel?: number,
): Promise<string> {
  if (channel != null) {
    const cfg = getChannelConfig(channel);
    switch (target) {
      case "soul":
        return cfg?.soulOverlay || "No channel soul overlay configured.";
      case "preferences":
        return cfg?.preferences || "No channel preferences configured.";
      case "topics":
        return cfg?.topics || "No topic restrictions configured.";
      case "daily": {
        const memory = await readDailyMemory(date, channel);
        return memory || "No channel memory found for this date.";
      }
      case "human":
        // Human facts are universal
        return loadHuman();
    }
  }

  switch (target) {
    case "soul":
      return loadSoul();
    case "preferences":
      return loadPreferences();
    case "human":
      return loadHuman();
    case "topics":
      return "Topics are only configurable per channel. Pass a channel ID.";
    case "daily": {
      const memory = await readDailyMemory(date);
      return memory || "No memory found for this date.";
    }
  }
}

async function writeTarget(
  target: "soul" | "preferences" | "human" | "daily" | "topics",
  content: string,
  channel?: number,
): Promise<string> {
  if (channel != null) {
    switch (target) {
      case "soul":
        upsertChannelConfig(channel, { soulOverlay: content });
        await refreshSessionContext(channel);
        return "Channel soul overlay updated.";
      case "preferences":
        upsertChannelConfig(channel, { preferences: content });
        await refreshSessionContext(channel);
        return "Channel preferences updated.";
      case "topics":
        upsertChannelConfig(channel, { topics: content });
        await refreshSessionContext(channel);
        return "Channel topics updated.";
      case "daily":
        await appendDailyMemory(content, channel);
        return "Channel daily memory written.";
      case "human":
        throw new Error("human memory is global and cannot be scoped to a channel");
    }
  }

  switch (target) {
    case "soul":
      await saveSoul(content);
      return "Soul updated.";
    case "preferences":
      await savePreferences(content);
      return "Preferences updated.";
    case "human":
      await saveHuman(content);
      return "Human profile updated.";
    case "topics":
      return "Topics are only configurable per channel. Pass a channel ID.";
    case "daily":
      await appendDailyMemory(content);
      return "Daily memory written.";
  }
}

async function appendTarget(
  target: "soul" | "preferences" | "human" | "daily" | "topics",
  content: string,
  channel?: number,
): Promise<string> {
  if (channel != null) {
    switch (target) {
      case "soul": {
        const cfg = getChannelConfig(channel);
        const existing = cfg?.soulOverlay ?? "";
        const updated = existing ? `${existing}\n${content}` : content;
        upsertChannelConfig(channel, { soulOverlay: updated });
        await refreshSessionContext(channel);
        return "Channel soul overlay appended.";
      }
      case "preferences": {
        const cfg = getChannelConfig(channel);
        const existing = cfg?.preferences ?? "";
        const bullet = content.startsWith("- ") ? content : `- ${content}`;
        const updated = existing ? `${existing}\n${bullet}` : bullet;
        upsertChannelConfig(channel, { preferences: updated });
        await refreshSessionContext(channel);
        return "Channel preference appended.";
      }
      case "daily":
        await appendDailyMemory(content, channel);
        return "Channel daily memory appended.";
      case "human":
        throw new Error("human memory is global and cannot be scoped to a channel");
      default:
        throw new Error(`append is not supported for ${target}`);
    }
  }

  switch (target) {
    case "preferences":
      await appendPreference(content);
      return "Preference appended.";
    case "human":
      await appendHuman(content);
      return "Human fact remembered.";
    case "daily":
      await appendDailyMemory(content);
      return "Daily memory appended.";
    default:
      throw new Error(`append is not supported for ${target}`);
  }
}
