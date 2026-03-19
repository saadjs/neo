import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  clearReasoningEffort,
  getModelForChat,
  getReasoningEffortForChat,
  setReasoningEffort,
  type ReasoningEffort,
} from "../agent";
import { getModelReasoningInfo } from "./model-catalog";
import { getCommandArgs } from "./command-text";
import { MODEL_PICKER_TTL_MS, MODEL_PICKER_MAX } from "../constants";

interface ReasoningPickerState {
  createdAt: number;
  levels: ReasoningEffort[];
  currentEffort: ReasoningEffort | undefined;
}

const reasoningPickers = new Map<string, ReasoningPickerState>();

function pruneExpiredPickers(now = Date.now()): void {
  for (const [pickerId, picker] of reasoningPickers) {
    if (now - picker.createdAt > MODEL_PICKER_TTL_MS) {
      reasoningPickers.delete(pickerId);
    }
  }

  while (reasoningPickers.size > MODEL_PICKER_MAX) {
    const oldestKey = reasoningPickers.keys().next().value;
    if (!oldestKey) break;
    reasoningPickers.delete(oldestKey);
  }
}

function createPickerId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function buildPickerText(currentEffort: ReasoningEffort | undefined, modelId: string): string {
  const lines = [
    `Set reasoning effort for this chat.`,
    `Model: ${modelId}`,
    `Current: ${currentEffort ?? "model default"}`,
  ];
  return lines.join("\n");
}

function buildPickerMarkup(
  pickerId: string,
  levels: ReasoningEffort[],
  currentEffort: ReasoningEffort | undefined,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (let i = 0; i < levels.length; i += 2) {
    const left = levels[i];
    const leftLabel = left === currentEffort ? `${left} ✓` : left;
    keyboard.text(leftLabel, `reasoning:set:${pickerId}:${left}`);

    const right = levels[i + 1];
    if (right) {
      const rightLabel = right === currentEffort ? `${right} ✓` : right;
      keyboard.text(rightLabel, `reasoning:set:${pickerId}:${right}`);
    }

    keyboard.row();
  }

  keyboard.text("Reset to default", `reasoning:reset:${pickerId}`);
  return keyboard;
}

function parseReasoningCallbackData(
  data: string,
):
  | { action: "set"; pickerId: string; level: string }
  | { action: "reset"; pickerId: string }
  | null {
  const parts = data.split(":");
  if (parts[0] !== "reasoning") return null;

  if (parts[1] === "set" && parts.length === 4) {
    return { action: "set", pickerId: parts[2], level: parts[3] };
  }

  if (parts[1] === "reset" && parts.length === 3) {
    return { action: "reset", pickerId: parts[2] };
  }

  return null;
}

export function isReasoningCallback(data: string | undefined): boolean {
  return typeof data === "string" && data.startsWith("reasoning:");
}

export async function handleReasoning(ctx: Context) {
  const chatId = String(ctx.chat!.id);
  const text = ctx.message?.text ?? "";
  const arg = getCommandArgs(text, "reasoning");

  const modelId = getModelForChat(chatId);
  const info = await getModelReasoningInfo(modelId);

  if (!info || !info.supported || info.levels.length === 0) {
    await ctx.reply(
      `The current model (\`${modelId}\`) does not support reasoning effort configuration.`,
      { parse_mode: "Markdown" },
    );
    return;
  }

  if (!arg) {
    pruneExpiredPickers();
    const pickerId = createPickerId();
    const currentEffort = getReasoningEffortForChat(chatId);

    reasoningPickers.set(pickerId, {
      createdAt: Date.now(),
      levels: info.levels,
      currentEffort,
    });

    await ctx.reply(buildPickerText(currentEffort, modelId), {
      reply_markup: buildPickerMarkup(pickerId, info.levels, currentEffort),
    });
    return;
  }

  if (arg === "reset" || arg === "default") {
    await clearReasoningEffort(chatId);
    await ctx.reply(
      "Reasoning effort reset to model default. Session will refresh on next message.",
    );
    return;
  }

  if (!info.levels.includes(arg as ReasoningEffort)) {
    await ctx.reply(
      `Invalid reasoning effort \`${arg}\`. Valid levels: ${info.levels.join(", ")}`,
      { parse_mode: "Markdown" },
    );
    return;
  }

  await setReasoningEffort(chatId, arg as ReasoningEffort);
  await ctx.reply(`Reasoning effort set to \`${arg}\`. Session will refresh on next message.`, {
    parse_mode: "Markdown",
  });
}

export async function handleReasoningCallback(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;
  const data = callbackQuery?.data;
  const parsed = data ? parseReasoningCallbackData(data) : null;

  if (!callbackQuery || !parsed) {
    return false;
  }

  const message = callbackQuery.message;
  if (!message || !("message_id" in message) || !ctx.chat) {
    await ctx.answerCallbackQuery({ text: "This picker is no longer available." });
    return true;
  }

  const picker = reasoningPickers.get(parsed.pickerId);
  if (!picker) {
    await ctx.answerCallbackQuery({ text: "This picker expired. Send /reasoning again." });
    return true;
  }

  try {
    if (parsed.action === "set") {
      if (!picker.levels.includes(parsed.level as ReasoningEffort)) {
        await ctx.answerCallbackQuery({ text: "That level is no longer available." });
        return true;
      }

      const level = parsed.level as ReasoningEffort;
      await setReasoningEffort(String(ctx.chat.id), level);
      reasoningPickers.delete(parsed.pickerId);

      await ctx.api.editMessageText(
        ctx.chat.id,
        message.message_id,
        `Reasoning effort set to ${level}. Session will refresh on next message.`,
      );
      await ctx.answerCallbackQuery({ text: `Set to ${level}` });
      return true;
    }

    if (parsed.action === "reset") {
      await clearReasoningEffort(String(ctx.chat.id));
      reasoningPickers.delete(parsed.pickerId);

      await ctx.api.editMessageText(
        ctx.chat.id,
        message.message_id,
        "Reasoning effort reset to model default. Session will refresh on next message.",
      );
      await ctx.answerCallbackQuery({ text: "Reset to default" });
      return true;
    }
  } catch {
    await ctx.answerCallbackQuery({ text: "Action failed. Try /reasoning again." });
    return true;
  }

  return false;
}
