import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  clearReasoningEffort,
  getModelForChat,
  getReasoningEffortForChat,
  switchModel,
} from "../agent";
import { MODELS_PER_PAGE, MODEL_PICKER_TTL_MS, MODEL_PICKER_MAX } from "../constants";
import { applyConfigChange } from "../runtime/state";
import { getCommandArgs } from "./command-text";
import {
  getModelReasoningInfo,
  loadCatalogModelsOutsideShortlist,
  loadModelCatalog,
  loadShortlistModels,
  type AvailableModel,
  type ShortlistModel,
} from "./model-catalog";

type ModelPickerView = "shortlist" | "all" | "manage" | "manage-item" | "catalog-item";

interface ModelPickerState {
  createdAt: number;
  currentModel: string;
  fetchedAt: string;
  shortlistModels: ShortlistModel[];
  allModels: AvailableModel[];
  stale: boolean;
  providers: string[];
  view: ModelPickerView;
  page: number;
  selectedIndex?: number;
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

function uniqueProviders(models: Array<Pick<AvailableModel, "provider">>): string[] {
  const seen = new Set<string>();
  for (const model of models) {
    if (model.provider) seen.add(model.provider);
  }
  return [...seen];
}

function buildShortlistLabel(model: ShortlistModel, index: number): string {
  const prefix = index === 0 ? "Primary" : `Fallback ${index}`;
  if (!model.available) {
    return `⚠ ${prefix}: ${model.id}`;
  }
  return `${prefix}: ${model.label}`;
}

function buildModelPickerText(picker: ModelPickerState): string {
  const lines = [
    picker.view === "shortlist"
      ? "Choose a model for this chat from your shortlist."
      : picker.view === "all"
        ? "Browse all available models not already in your shortlist."
        : picker.view === "manage"
          ? "Manage your global model shortlist."
          : picker.view === "manage-item"
            ? "Edit this shortlist entry."
            : "Choose what to do with this catalog model.",
    `Current: ${picker.currentModel}`,
  ];

  if (picker.providers.length > 0) {
    lines.push(`Providers: ${picker.providers.join(", ")}`);
  }

  if (picker.view === "shortlist" && picker.shortlistModels.length === 0) {
    lines.push("No shortlisted models yet. Use Show All to add your primary and fallbacks.");
  }

  if (picker.view === "manage" && picker.shortlistModels.length === 0) {
    lines.push("No shortlisted models to manage yet.");
  }

  if (picker.view === "all" && picker.allModels.length === 0) {
    lines.push("Every currently available model is already in your shortlist.");
  }

  if (picker.view === "manage-item" && picker.selectedIndex !== undefined) {
    const model = picker.shortlistModels[picker.selectedIndex];
    if (model) {
      lines.push(`Entry: ${model.id}`);
      lines.push(`Position: ${picker.selectedIndex + 1} of ${picker.shortlistModels.length}`);
      if (!model.available) {
        lines.push("This model is currently unavailable in the live catalog.");
      }
    }
  }

  if (picker.view === "catalog-item" && picker.selectedIndex !== undefined) {
    const model = picker.allModels[picker.selectedIndex];
    if (model) {
      lines.push(`Model: ${model.id}`);
    }
  }

  lines.push(`Catalog fetched: ${picker.fetchedAt}`);

  if (picker.view === "shortlist" || picker.view === "all" || picker.view === "manage") {
    const total = picker.view === "all" ? picker.allModels.length : picker.shortlistModels.length;
    const totalPages = Math.max(1, Math.ceil(total / MODELS_PER_PAGE));
    lines.push(`Page ${picker.page + 1} of ${totalPages}`);
  }

  if (picker.stale) {
    lines.push("Using stale cached catalog because refresh failed.");
  }

  return lines.join("\n");
}

function appendPagedRows(
  keyboard: InlineKeyboard,
  labels: { text: string; callback: string }[],
  page: number,
  pickerId: string,
): void {
  const totalPages = Math.max(1, Math.ceil(labels.length / MODELS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const startIndex = safePage * MODELS_PER_PAGE;
  const pageItems = labels.slice(startIndex, startIndex + MODELS_PER_PAGE);

  for (let i = 0; i < pageItems.length; i += 2) {
    const left = pageItems[i];
    keyboard.text(left.text, left.callback);

    const right = pageItems[i + 1];
    if (right) {
      keyboard.text(right.text, right.callback);
    }

    keyboard.row();
  }

  if (totalPages > 1) {
    if (safePage > 0) keyboard.text("Prev", `model:page:${pickerId}:${safePage - 1}`);
    if (safePage < totalPages - 1) keyboard.text("Next", `model:page:${pickerId}:${safePage + 1}`);
    keyboard.row();
  }
}

function buildModelPickerMarkup(pickerId: string, picker: ModelPickerState): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (picker.view === "shortlist") {
    appendPagedRows(
      keyboard,
      picker.shortlistModels.map((model, index) => ({
        text: buildShortlistLabel(model, index),
        callback: `model:set:shortlist:${pickerId}:${index}`,
      })),
      picker.page,
      pickerId,
    );
    keyboard.text("Show All", `model:view:all:${pickerId}`);
    keyboard.text("Manage Shortlist", `model:view:manage:${pickerId}`);
    keyboard.row();
    keyboard.text("Refresh", `model:refresh:${pickerId}`);
    return keyboard;
  }

  if (picker.view === "manage") {
    appendPagedRows(
      keyboard,
      picker.shortlistModels.map((model, index) => ({
        text: buildShortlistLabel(model, index),
        callback: `model:manage:${pickerId}:${index}`,
      })),
      picker.page,
      pickerId,
    );
    keyboard.text("Back", `model:view:shortlist:${pickerId}`);
    keyboard.text("Show All", `model:view:all:${pickerId}`);
    keyboard.row();
    keyboard.text("Refresh", `model:refresh:${pickerId}`);
    return keyboard;
  }

  if (picker.view === "manage-item" && picker.selectedIndex !== undefined) {
    keyboard.text("Promote to Primary", `model:reorder:${pickerId}:${picker.selectedIndex}:top`);
    keyboard.row();
    keyboard.text("Move Up", `model:reorder:${pickerId}:${picker.selectedIndex}:up`);
    keyboard.text("Move Down", `model:reorder:${pickerId}:${picker.selectedIndex}:down`);
    keyboard.row();
    keyboard.text("Remove", `model:remove:${pickerId}:${picker.selectedIndex}`);
    keyboard.row();
    keyboard.text("Back", `model:view:manage:${pickerId}`);
    return keyboard;
  }

  if (picker.view === "all") {
    appendPagedRows(
      keyboard,
      picker.allModels.map((model, index) => ({
        text: model.label,
        callback: `model:catalog:${pickerId}:${index}`,
      })),
      picker.page,
      pickerId,
    );
    keyboard.text("Back", `model:view:shortlist:${pickerId}`);
    keyboard.text("Refresh", `model:refresh:${pickerId}`);
    return keyboard;
  }

  if (picker.view === "catalog-item" && picker.selectedIndex !== undefined) {
    keyboard.text("Use Now", `model:set:all:${pickerId}:${picker.selectedIndex}`);
    keyboard.row();
    keyboard.text("Add as Primary", `model:add:${pickerId}:${picker.selectedIndex}:primary`);
    keyboard.row();
    keyboard.text("Add as Fallback", `model:add:${pickerId}:${picker.selectedIndex}:fallback`);
    keyboard.row();
    keyboard.text("Back", `model:view:all:${pickerId}`);
    return keyboard;
  }

  keyboard.text("Back", `model:view:shortlist:${pickerId}`);
  return keyboard;
}

function getModelPickerMessage(pickerId: string) {
  const picker = modelPickers.get(pickerId);
  if (!picker) return null;

  return {
    text: buildModelPickerText(picker),
    reply_markup: buildModelPickerMarkup(pickerId, picker),
  };
}

type ParsedModelCallback =
  | { action: "set"; source: "shortlist" | "all"; pickerId: string; index: number }
  | { action: "page"; pickerId: string; page: number }
  | { action: "refresh"; pickerId: string }
  | { action: "view"; pickerId: string; view: "shortlist" | "all" | "manage" }
  | { action: "manage"; pickerId: string; index: number }
  | { action: "catalog"; pickerId: string; index: number }
  | { action: "add"; pickerId: string; index: number; mode: "primary" | "fallback" }
  | { action: "reorder"; pickerId: string; index: number; direction: "top" | "up" | "down" }
  | { action: "remove"; pickerId: string; index: number };

function parseModelCallbackData(data: string): ParsedModelCallback | null {
  const parts = data.split(":");
  if (parts[0] !== "model") return null;

  if (parts[1] === "set" && parts.length === 5) {
    const index = Number(parts[4]);
    if (!Number.isInteger(index) || index < 0) return null;
    if (parts[2] !== "shortlist" && parts[2] !== "all") return null;
    return { action: "set", source: parts[2], pickerId: parts[3], index };
  }

  if (parts[1] === "page" && parts.length === 4) {
    const page = Number(parts[3]);
    if (!Number.isInteger(page) || page < 0) return null;
    return { action: "page", pickerId: parts[2], page };
  }

  if (parts[1] === "refresh" && parts.length === 3) {
    return { action: "refresh", pickerId: parts[2] };
  }

  if (parts[1] === "view" && parts.length === 4) {
    const view = parts[2];
    if (view !== "shortlist" && view !== "all" && view !== "manage") return null;
    return { action: "view", pickerId: parts[3], view };
  }

  if (parts[1] === "manage" && parts.length === 4) {
    const index = Number(parts[3]);
    if (!Number.isInteger(index) || index < 0) return null;
    return { action: "manage", pickerId: parts[2], index };
  }

  if (parts[1] === "catalog" && parts.length === 4) {
    const index = Number(parts[3]);
    if (!Number.isInteger(index) || index < 0) return null;
    return { action: "catalog", pickerId: parts[2], index };
  }

  if (parts[1] === "add" && parts.length === 5) {
    const index = Number(parts[3]);
    if (!Number.isInteger(index) || index < 0) return null;
    if (parts[4] !== "primary" && parts[4] !== "fallback") return null;
    return { action: "add", pickerId: parts[2], index, mode: parts[4] };
  }

  if (parts[1] === "reorder" && parts.length === 5) {
    const index = Number(parts[3]);
    if (!Number.isInteger(index) || index < 0) return null;
    if (parts[4] !== "top" && parts[4] !== "up" && parts[4] !== "down") return null;
    return {
      action: "reorder",
      pickerId: parts[2],
      index,
      direction: parts[4],
    };
  }

  if (parts[1] === "remove" && parts.length === 4) {
    const index = Number(parts[3]);
    if (!Number.isInteger(index) || index < 0) return null;
    return { action: "remove", pickerId: parts[2], index };
  }

  return null;
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

async function refreshModelPickerState(
  picker: ModelPickerState,
  options?: { forceRefresh?: boolean },
): Promise<void> {
  const [shortlist, allCatalog] = await Promise.all([
    loadShortlistModels(options),
    loadCatalogModelsOutsideShortlist(options),
  ]);

  picker.shortlistModels = shortlist.models;
  picker.allModels = allCatalog.models;
  picker.fetchedAt = allCatalog.fetchedAt;
  picker.stale = allCatalog.stale;
  picker.providers = uniqueProviders([
    ...shortlist.models.filter((model) => model.available),
    ...allCatalog.models,
  ]);
  const total =
    picker.view === "all" || picker.view === "catalog-item"
      ? picker.allModels.length
      : picker.shortlistModels.length;
  const totalPages = Math.max(1, Math.ceil(total / MODELS_PER_PAGE));
  picker.page = Math.min(picker.page, totalPages - 1);
}

function registerModelPicker(
  shortlist: Awaited<ReturnType<typeof loadShortlistModels>>,
  allCatalog: Awaited<ReturnType<typeof loadCatalogModelsOutsideShortlist>>,
  currentModel: string,
): string {
  pruneExpiredPickers();
  const pickerId = createPickerId();
  modelPickers.set(pickerId, {
    createdAt: Date.now(),
    currentModel,
    fetchedAt: allCatalog.fetchedAt,
    shortlistModels: shortlist.models,
    allModels: allCatalog.models,
    stale: allCatalog.stale,
    providers: uniqueProviders([
      ...shortlist.models.filter((model) => model.available),
      ...allCatalog.models,
    ]),
    view: "shortlist",
    page: 0,
  });
  return pickerId;
}

async function persistModelShortlist(nextShortlist: string[], reason: string): Promise<void> {
  await applyConfigChange({
    key: "MODEL_SHORTLIST",
    value: JSON.stringify(nextShortlist),
    actor: "user",
    source: "command",
    reason,
  });
}

function moveShortlistItem(
  shortlist: ShortlistModel[],
  index: number,
  direction: "top" | "up" | "down",
): string[] {
  const ids = shortlist.map((model) => model.id);
  if (index < 0 || index >= ids.length) return ids;

  const [selected] = ids.splice(index, 1);
  if (!selected) return ids;

  if (direction === "top") {
    ids.unshift(selected);
    return ids;
  }

  const targetIndex = direction === "up" ? Math.max(0, index - 1) : Math.min(ids.length, index + 1);
  ids.splice(targetIndex, 0, selected);
  return ids;
}

export function isModelCallback(data: string | undefined): boolean {
  return typeof data === "string" && data.startsWith("model:");
}

export async function handleModel(ctx: Context) {
  const text = ctx.message?.text ?? "";
  const model = getCommandArgs(text, "model");

  if (!model) {
    try {
      const currentModel = getModelForChat(ctx.chat!.id);
      const [shortlist, allCatalog] = await Promise.all([
        loadShortlistModels(),
        loadCatalogModelsOutsideShortlist(),
      ]);
      const pickerId = registerModelPicker(shortlist, allCatalog, currentModel);
      const message = getModelPickerMessage(pickerId);

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
    const catalog = await loadModelCatalog();
    const match = catalog.models.find((candidate) => candidate.id === model);
    if (!match) {
      await ctx.reply(`Unknown model: \`${model}\`\nUse /model to see available models.`, {
        parse_mode: "Markdown",
      });
      return;
    }

    await switchModel(ctx.chat!.id, match.id);
    let reply = `Session model switched to \`${match.id}\` for this chat only.`;
    reply += await buildReasoningNote(ctx.chat!.id, match.id);
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

  const pickerId = "pickerId" in parsed ? parsed.pickerId : undefined;
  const picker = pickerId ? modelPickers.get(pickerId) : undefined;

  if (pickerId && !picker) {
    await ctx.answerCallbackQuery({ text: "This picker expired. Send /model again." });
    return true;
  }

  try {
    if (parsed.action === "page" && picker) {
      picker.page = parsed.page;
      const next = getModelPickerMessage(parsed.pickerId);
      if (next) {
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, next.text, {
          reply_markup: next.reply_markup,
        });
      }
      await ctx.answerCallbackQuery();
      return true;
    }

    if (!picker) {
      await ctx.answerCallbackQuery({ text: "This picker expired. Send /model again." });
      return true;
    }

    if (parsed.action === "refresh") {
      await refreshModelPickerState(picker, { forceRefresh: true });
      const next = getModelPickerMessage(parsed.pickerId);
      if (next) {
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, next.text, {
          reply_markup: next.reply_markup,
        });
      }
      await ctx.answerCallbackQuery({ text: "Model list refreshed." });
      return true;
    }

    if (parsed.action === "view") {
      picker.view = parsed.view;
      picker.page = 0;
      picker.selectedIndex = undefined;
      const next = getModelPickerMessage(parsed.pickerId);
      if (next) {
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, next.text, {
          reply_markup: next.reply_markup,
        });
      }
      await ctx.answerCallbackQuery();
      return true;
    }

    if (parsed.action === "manage") {
      picker.view = "manage-item";
      picker.selectedIndex = parsed.index;
      const next = getModelPickerMessage(parsed.pickerId);
      if (next) {
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, next.text, {
          reply_markup: next.reply_markup,
        });
      }
      await ctx.answerCallbackQuery();
      return true;
    }

    if (parsed.action === "catalog") {
      picker.view = "catalog-item";
      picker.selectedIndex = parsed.index;
      const next = getModelPickerMessage(parsed.pickerId);
      if (next) {
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, next.text, {
          reply_markup: next.reply_markup,
        });
      }
      await ctx.answerCallbackQuery();
      return true;
    }

    if (parsed.action === "remove") {
      const selected = picker.shortlistModels[parsed.index];
      if (!selected) {
        await ctx.answerCallbackQuery({ text: "That shortlist entry is no longer available." });
        return true;
      }

      const nextShortlist = picker.shortlistModels
        .filter((_, index) => index !== parsed.index)
        .map((model) => model.id);
      await persistModelShortlist(
        nextShortlist,
        `Removed ${selected.id} from the model shortlist.`,
      );
      await refreshModelPickerState(picker);
      picker.view = "manage";
      picker.selectedIndex = undefined;
      const next = getModelPickerMessage(parsed.pickerId);
      if (next) {
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, next.text, {
          reply_markup: next.reply_markup,
        });
      }
      await ctx.answerCallbackQuery({ text: "Removed from shortlist." });
      return true;
    }

    if (parsed.action === "reorder") {
      const selected = picker.shortlistModels[parsed.index];
      if (!selected) {
        await ctx.answerCallbackQuery({ text: "That shortlist entry is no longer available." });
        return true;
      }

      const nextShortlist = moveShortlistItem(
        picker.shortlistModels,
        parsed.index,
        parsed.direction,
      );
      await persistModelShortlist(
        nextShortlist,
        `Reordered ${selected.id} in the model shortlist.`,
      );
      await refreshModelPickerState(picker);
      picker.view = "manage";
      picker.selectedIndex = undefined;
      const next = getModelPickerMessage(parsed.pickerId);
      if (next) {
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, next.text, {
          reply_markup: next.reply_markup,
        });
      }
      await ctx.answerCallbackQuery({ text: "Shortlist updated." });
      return true;
    }

    if (parsed.action === "set") {
      const selected =
        parsed.source === "shortlist"
          ? picker.shortlistModels[parsed.index]
          : picker.allModels[parsed.index];
      if (!selected) {
        await ctx.answerCallbackQuery({ text: "That model is no longer available." });
        return true;
      }
      if ("available" in selected && !selected.available) {
        await ctx.answerCallbackQuery({ text: "That shortlisted model is unavailable right now." });
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

    if (parsed.action === "add") {
      const selected = picker.allModels[parsed.index];
      if (!selected) {
        await ctx.answerCallbackQuery({ text: "That model is no longer available." });
        return true;
      }

      const nextShortlist =
        parsed.mode === "primary"
          ? [selected.id, ...picker.shortlistModels.map((model) => model.id)]
          : [...picker.shortlistModels.map((model) => model.id), selected.id];
      await persistModelShortlist(
        nextShortlist,
        `Added ${selected.id} to the model shortlist as ${parsed.mode}.`,
      );
      await refreshModelPickerState(picker);
      picker.view = "shortlist";
      picker.page = 0;
      picker.selectedIndex = undefined;
      const next = getModelPickerMessage(parsed.pickerId);
      if (next) {
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, next.text, {
          reply_markup: next.reply_markup,
        });
      }
      await ctx.answerCallbackQuery({
        text: parsed.mode === "primary" ? "Added as primary." : "Added as fallback.",
      });
      return true;
    }

    return true;
  } catch {
    await ctx.answerCallbackQuery({ text: "Model action failed. Try /model again." });
    return true;
  }
}
