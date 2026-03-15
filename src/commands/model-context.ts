import { getModelForChat, getReasoningEffortForChat, type ReasoningEffort } from "../agent.js";
import { config } from "../config.js";

export type ChatModelContext = {
  defaultModel: string;
  currentModel: string;
  overrideActive: boolean;
  reasoningEffort: ReasoningEffort | undefined;
};

export function getChatModelContext(chatId: number): ChatModelContext {
  const defaultModel = config.copilot.model;
  const currentModel = getModelForChat(chatId);

  return {
    defaultModel,
    currentModel,
    overrideActive: currentModel !== defaultModel,
    reasoningEffort: getReasoningEffortForChat(chatId),
  };
}

export function formatChatModelContextMarkdown(context: ChatModelContext): string {
  const modelLine = context.overrideActive
    ? `Default model: \`${context.defaultModel}\`\nCurrent chat model: \`${context.currentModel}\` (override active)`
    : `Default model: \`${context.defaultModel}\`\nCurrent chat model: \`${context.currentModel}\` (using default)`;

  const reasoningLine = context.reasoningEffort
    ? `Reasoning effort: \`${context.reasoningEffort}\` (override active)`
    : "Reasoning effort: model default";

  return `${modelLine}\n${reasoningLine}`;
}
