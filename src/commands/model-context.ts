import { getModelForChat, getReasoningEffortForChat, type ReasoningEffort } from "../agent";
import { config } from "../config";
import { getChannelConfig } from "../memory/db";
import { parseQualifiedModel, getConfiguredProviders } from "../providers";

export type ChatModelContext = {
  defaultModel: string;
  channelDefaultModel: string | null;
  currentModel: string;
  overrideActive: boolean;
  reasoningEffort: ReasoningEffort | undefined;
  channelDefaultReasoningEffort: string | null;
  provider: string;
  configuredProviders: string[];
};

export function getChatModelContext(chatId: number): ChatModelContext {
  const defaultModel = config.copilot.model;
  const currentModel = getModelForChat(chatId);
  const channelConfig = getChannelConfig(chatId);
  const channelDefaultModel = channelConfig?.defaultModel ?? null;
  const channelDefaultReasoningEffort = channelConfig?.defaultReasoningEffort ?? null;

  const effectiveDefault = channelDefaultModel ?? defaultModel;
  const { providerKey } = parseQualifiedModel(currentModel);
  const providers = getConfiguredProviders();
  const allProviderKeys = ["copilot", ...providers.map((p) => p.key)];

  return {
    defaultModel,
    channelDefaultModel,
    currentModel,
    overrideActive: currentModel !== effectiveDefault,
    reasoningEffort: getReasoningEffortForChat(chatId),
    channelDefaultReasoningEffort,
    provider: providerKey ?? "copilot",
    configuredProviders: allProviderKeys,
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

  lines.push(`Provider: ${context.provider}`);

  if (context.configuredProviders.length > 1) {
    lines.push(`Available providers: ${context.configuredProviders.join(", ")}`);
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
