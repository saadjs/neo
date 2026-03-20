import { getModelForChat, getReasoningEffortForChat, type ReasoningEffort } from "../agent";
import { config } from "../config";
import { getChannelConfig } from "../memory/db";

export type ChatModelContext = {
  defaultModel: string;
  channelDefaultModel: string | null;
  currentModel: string;
  overrideActive: boolean;
  reasoningEffort: ReasoningEffort | undefined;
  channelDefaultReasoningEffort: string | null;
};

export function getChatModelContext(chatId: number): ChatModelContext {
  const defaultModel = config.copilot.model;
  const currentModel = getModelForChat(chatId);
  const channelConfig = getChannelConfig(chatId);
  const channelDefaultModel = channelConfig?.defaultModel ?? null;
  const channelDefaultReasoningEffort = channelConfig?.defaultReasoningEffort ?? null;

  // Override is active when the resolved model differs from what
  // the channel default (or global default) would give
  const effectiveDefault = channelDefaultModel ?? defaultModel;
  return {
    defaultModel,
    channelDefaultModel,
    currentModel,
    overrideActive: currentModel !== effectiveDefault,
    reasoningEffort: getReasoningEffortForChat(chatId),
    channelDefaultReasoningEffort,
  };
}

export function formatChatModelContextMarkdown(context: ChatModelContext): string {
  const lines: string[] = [`Default model: \`${context.defaultModel}\``];

  if (context.channelDefaultModel) {
    lines.push(`Channel default: \`${context.channelDefaultModel}\``);
  }

  if (context.overrideActive) {
    lines.push(`Current chat model: \`${context.currentModel}\` (override active)`);
  } else {
    const source = context.channelDefaultModel ? "channel default" : "default";
    lines.push(`Current chat model: \`${context.currentModel}\` (using ${source})`);
  }

  if (context.reasoningEffort) {
    const isChannelDefault = context.channelDefaultReasoningEffort === context.reasoningEffort;
    const label = isChannelDefault ? "channel default" : "override active";
    lines.push(`Reasoning effort: \`${context.reasoningEffort}\` (${label})`);
  } else if (context.channelDefaultReasoningEffort) {
    lines.push(`Reasoning effort: \`${context.channelDefaultReasoningEffort}\` (channel default)`);
  } else {
    lines.push("Reasoning effort: model default");
  }

  return lines.join("\n");
}
