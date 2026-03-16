import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  clearReasoningEffort,
  getModelForChat,
  getReasoningEffortForChat,
  switchModel,
} from "../agent";
import {
  getModelReasoningInfo,
  loadModelCatalog,
  type AvailableModel,
  type ModelCatalogResult,
} from "./model-catalog";
import { getCommandArgs } from "./command-text";
import { MODELS_PER_PAGE, MODEL_PICKER_TTL_MS, MODEL_PICKER_MAX } from "../constants";

interface ModelPickerState {
  createdAt: number;
  currentModel: string;
  fetchedAt: string;
  models: AvailableModel[];
  stale: boolean;
}

const modelPickers = new Map<string, ModelPickerState>();

function pruneExpiredPickers(now = Date.now()): void {
  for (const [pickerId, picker] of modelPickers) {
    if (now - picker.createdAt > MODEL_PICKER_TTL_MS) {
      modelPickers.delete(pickerId);
    }
  }

  while (modelPickers.size > MODEL_PICKER_MAX) {
    const oldestKey = modelPickers.keys().next().value;
    if (!oldestKey) break;
    modelPickers.delete(oldestKey);
  }
}

function createPickerId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function buildModelPickerText(
  currentModel: string,
  fetchedAt: string,
  page: number,
  totalPages: number,
  stale: boolean,
): string {
  const lines = [
    "Choose a model for this chat.",
    `Current: ${currentModel}`,
    `Catalog fetched: ${fetchedAt}`,
    `Page ${page + 1} of ${totalPages}`,
  ];

  if (stale) {
    lines.push("Using stale cached catalog because GitHub refresh failed.");
  }

  return lines.join("\n");
}

function buildModelPickerMarkup(
  pickerId: string,
  models: AvailableModel[],
  page: number,
): InlineKeyboard {
  const totalPages = Math.max(1, Math.ceil(models.length / MODELS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const startIndex = safePage * MODELS_PER_PAGE;
  const pageModels = models.slice(startIndex, startIndex + MODELS_PER_PAGE);
  const keyboard = new InlineKeyboard();

  for (let i = 0; i < pageModels.length; i += 2) {
    const left = pageModels[i];
    const leftIndex = startIndex + i;
    keyboard.text(left.label, `model:set:${pickerId}:${leftIndex}`);

    const right = pageModels[i + 1];
    if (right) {
      const rightIndex = startIndex + i + 1;
      keyboard.text(right.label, `model:set:${pickerId}:${rightIndex}`);
    }

    keyboard.row();
  }

  if (totalPages > 1) {
    if (safePage > 0) {
      keyboard.text("Prev", `model:page:${pickerId}:${safePage - 1}`);
    }
    if (safePage < totalPages - 1) {
      keyboard.text("Next", `model:page:${pickerId}:${safePage + 1}`);
    }
    keyboard.row();
  }

  keyboard.text("Refresh", `model:refresh:${pickerId}`);
  return keyboard;
}

function parseModelCallbackData(
  data: string,
):
  | { action: "set"; pickerId: string; index: number }
  | { action: "page"; pickerId: string; page: number }
  | { action: "refresh"; pickerId: string }
  | null {
  const parts = data.split(":");
  if (parts[0] !== "model") return null;

  if (parts[1] === "set" && parts.length === 4) {
    const index = Number(parts[3]);
    if (!Number.isInteger(index) || index < 0) return null;
    return { action: "set", pickerId: parts[2], index };
  }

  if (parts[1] === "page" && parts.length === 4) {
    const page = Number(parts[3]);
    if (!Number.isInteger(page) || page < 0) return null;
    return { action: "page", pickerId: parts[2], page };
  }

  if (parts[1] === "refresh" && parts.length === 3) {
    return { action: "refresh", pickerId: parts[2] };
  }

  return null;
}

function registerModelPicker(catalog: ModelCatalogResult, currentModel: string): string {
  pruneExpiredPickers();
  const pickerId = createPickerId();
  modelPickers.set(pickerId, {
    createdAt: Date.now(),
    currentModel,
    fetchedAt: catalog.fetchedAt,
    models: catalog.models,
    stale: catalog.stale,
  });
  return pickerId;
}

function getModelPickerMessage(pickerId: string, page: number) {
  const picker = modelPickers.get(pickerId);
  if (!picker) return null;

  const totalPages = Math.max(1, Math.ceil(picker.models.length / MODELS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);

  return {
    text: buildModelPickerText(
      picker.currentModel,
      picker.fetchedAt,
      safePage,
      totalPages,
      picker.stale,
    ),
    reply_markup: buildModelPickerMarkup(pickerId, picker.models, safePage),
  };
}

export function isModelCallback(data: string | undefined): boolean {
  return typeof data === "string" && data.startsWith("model:");
}

async function buildReasoningNote(chatId: number, newModelId: string): Promise<string> {
  let info: Awaited<ReturnType<typeof getModelReasoningInfo>> = null;
  try {
    info = await getModelReasoningInfo(newModelId);
  } catch {
    return "";
  }

  const currentEffort = getReasoningEffortForChat(chatId);

  if (!info || !info.supported) {
    if (currentEffort) {
      await clearReasoningEffort(chatId);
      return "\nReasoning effort override cleared (not supported by this model).";
    }
    return "\nReasoning effort: not supported by this model.";
  }

  if (currentEffort && !info.levels.includes(currentEffort)) {
    await clearReasoningEffort(chatId);
    return `\nReasoning effort override cleared (\`${currentEffort}\` not supported). Default: ${info.defaultLevel ?? "unknown"}. Use /reasoning to change.`;
  }

  if (currentEffort) {
    return `\nReasoning effort: ${currentEffort} (override). Default: ${info.defaultLevel ?? "unknown"}. Use /reasoning to change.`;
  }
  return `\nReasoning effort: ${info.defaultLevel ?? "unknown"} (default). Use /reasoning to change.`;
}

export async function handleModel(ctx: Context) {
  const text = ctx.message?.text ?? "";
  const model = getCommandArgs(text, "model");

  if (!model) {
    try {
      const currentModel = getModelForChat(ctx.chat!.id);
      const catalog = await loadModelCatalog();
      const pickerId = registerModelPicker(catalog, currentModel);
      const message = getModelPickerMessage(pickerId, 0);

      if (!message) {
        await ctx.reply("Failed to build the model picker. Try /model again.");
        return;
      }

      await ctx.reply(message.text, { reply_markup: message.reply_markup });
    } catch (err) {
      await ctx.reply(`Failed to load available models: ${err}`);
    }
    return;
  }

  try {
    await switchModel(ctx.chat!.id, model);
    let reply = `Session model switched to \`${model}\` for this chat only.`;
    reply += await buildReasoningNote(ctx.chat!.id, model);
    await ctx.reply(reply, { parse_mode: "Markdown" });
  } catch (err) {
    await ctx.reply(`Failed to switch model: ${err}`);
  }
}

export async function handleModelCallback(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;
  const data = callbackQuery?.data;
  const parsed = data ? parseModelCallbackData(data) : null;

  if (!callbackQuery || !parsed) {
    return false;
  }

  const message = callbackQuery.message;
  if (!message || !("message_id" in message) || !ctx.chat) {
    await ctx.answerCallbackQuery({ text: "This picker is no longer available." });
    return true;
  }

  const picker = modelPickers.get(parsed.pickerId);
  if (!picker) {
    await ctx.answerCallbackQuery({ text: "This picker expired. Send /model again." });
    return true;
  }

  try {
    if (parsed.action === "set") {
      const selected = picker.models[parsed.index];
      if (!selected) {
        await ctx.answerCallbackQuery({ text: "That model is no longer available." });
        return true;
      }

      await switchModel(ctx.chat.id, selected.id);
      picker.currentModel = selected.id;
      modelPickers.delete(parsed.pickerId);

      let confirmText = `✅ Session model switched to ${selected.id} for this chat.`;
      confirmText += await buildReasoningNote(ctx.chat.id, selected.id);

      await ctx.api.editMessageText(ctx.chat.id, message.message_id, confirmText);
      await ctx.answerCallbackQuery({ text: `Switched to ${selected.id}` });
      return true;
    }

    if (parsed.action === "refresh") {
      const catalog = await loadModelCatalog({ forceRefresh: true });
      picker.models = catalog.models;
      picker.fetchedAt = catalog.fetchedAt;
      picker.stale = catalog.stale;

      const nextMessage = getModelPickerMessage(parsed.pickerId, 0);
      if (nextMessage) {
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, nextMessage.text, {
          reply_markup: nextMessage.reply_markup,
        });
      }
      await ctx.answerCallbackQuery({ text: "Model list refreshed." });
      return true;
    }

    const nextMessage = getModelPickerMessage(parsed.pickerId, parsed.page);
    if (nextMessage) {
      await ctx.api.editMessageText(ctx.chat.id, message.message_id, nextMessage.text, {
        reply_markup: nextMessage.reply_markup,
      });
    }
    await ctx.answerCallbackQuery();
    return true;
  } catch {
    await ctx.answerCallbackQuery({ text: "Model action failed. Try /model again." });
    return true;
  }
}
