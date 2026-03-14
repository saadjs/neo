import { getModelForChat } from "../agent.js";
import { config } from "../config.js";

export type ChatModelContext = {
  defaultModel: string;
  currentModel: string;
  overrideActive: boolean;
};

export function getChatModelContext(chatId: number): ChatModelContext {
  const defaultModel = config.copilot.model;
  const currentModel = getModelForChat(chatId);

  return {
    defaultModel,
    currentModel,
    overrideActive: currentModel !== defaultModel,
  };
}

export function formatChatModelContextMarkdown(context: ChatModelContext): string {
  if (context.overrideActive) {
    return `Default model: \`${context.defaultModel}\`\nCurrent chat model: \`${context.currentModel}\` (override active)`;
  }

  return `Default model: \`${context.defaultModel}\`\nCurrent chat model: \`${context.currentModel}\` (using default)`;
}
