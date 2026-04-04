import type { Context } from "grammy";
import type { MessageOptions } from "@github/copilot-sdk";
import { getPendingUserInput } from "../telegram/user-input";
import { getCommandArgs } from "./command-text";

const URL_PATTERN = /^https?:\/\//;

export type MessageSender = (
  ctx: Context,
  text: string,
  attachments?: MessageOptions["attachments"],
) => Promise<void>;

export function parseResearchArgs(raw: string): { topic: string; links: string[] } {
  const tokens = raw.split(/\s+/).filter(Boolean);
  const links: string[] = [];
  const topicWords: string[] = [];

  for (const token of tokens) {
    if (URL_PATTERN.test(token)) {
      links.push(token);
    } else {
      topicWords.push(token);
    }
  }

  return { topic: topicWords.join(" "), links };
}

export function buildResearchPrompt(topic: string, links: string[]): string {
  const sourceLinks = links.length > 0 ? ` source_links=${JSON.stringify(links)}` : "";

  return `Invoke the research tool with topic=${JSON.stringify(topic)}${sourceLinks}. Treat the plan it returns as mandatory. Execute the research with the built-in tools it calls for, complete the validation checklist before saving, and do not consider the task done until the final report exists at the saved path and you can cite that path back to the user.`;
}

export function createResearchHandler(sendMessage: MessageSender) {
  return async function handleResearch(ctx: Context) {
    if (ctx.chat?.id && getPendingUserInput(ctx.chat.id)) {
      await ctx.reply(
        "I’m waiting for a text answer to the pending question before I can continue.",
      );
      return;
    }

    const raw = getCommandArgs(ctx.message?.text, "research");

    if (!raw) {
      await ctx.reply(
        "Usage: `/research <topic> [url1 url2 ...]`\n\nExamples:\n" +
          "• `/research quantum computing advances 2025`\n" +
          "• `/research rust vs go https://blog.rust-lang.org`",
        { parse_mode: "Markdown" },
      );
      return;
    }

    const { topic, links } = parseResearchArgs(raw);

    if (!topic) {
      await ctx.reply("Please provide a research topic, not just links.");
      return;
    }

    const prompt = buildResearchPrompt(topic, links);
    await sendMessage(ctx, prompt);
  };
}
