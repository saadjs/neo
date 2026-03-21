import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { config } from "../config";
import {
  VALID_REASONING_EFFORTS,
  MODEL_PICKER_TTL_MS,
  MODEL_PICKER_MAX,
  MODELS_PER_PAGE,
} from "../constants";
import { getChannelConfig, upsertChannelConfig } from "../memory/db";
import { getModelForChat, getPerChatModelOverride, refreshSessionContext } from "../agent";
import { getModelReasoningInfo, loadModelCatalog, type AvailableModel } from "./model-catalog";
import type { ReasoningEffort } from "../agent";

export async function handleChannel(ctx: Context) {
  const chatId = ctx.chat!.id;

  if (chatId === config.telegram.ownerId) {
    await ctx.reply("Channel config is for group chats. This is a DM.");
    return;
  }

  const text = ctx.message?.text ?? "";
  const args = text.replace(/^\/channel(?:@[\w_]+)?\s*/, "").trim();

  if (!args) {
    return showChannelConfig(ctx, chatId);
  }

  const [subcommand, ...rest] = args.split(/\s+/);
  const value = rest.join(" ").trim();

  switch (subcommand) {
    case "label":
      if (!value) {
        await ctx.reply("Usage: /channel label <name>");
        return;
      }
      upsertChannelConfig(chatId, { label: value });
      await refreshSessionContext(chatId);
      await ctx.reply(`Channel label set to: ${value}`);
      break;

    case "topics":
      if (!value) {
        await ctx.reply("Usage: /channel topics <t1,t2,...> or /channel topics clear");
        return;
      }
      if (value === "clear") {
        upsertChannelConfig(chatId, { topics: null });
        await refreshSessionContext(chatId);
        await ctx.reply("Topic restrictions removed.");
      } else {
        upsertChannelConfig(chatId, { topics: value });
        await refreshSessionContext(chatId);
        await ctx.reply(`Topics set to: ${value}`);
      }
      break;

    case "soul": {
      if (!value) {
        await ctx.reply("Usage: /channel soul <text> or /channel soul clear");
        return;
      }
      if (value === "clear") {
        upsertChannelConfig(chatId, { soulOverlay: null });
        await refreshSessionContext(chatId);
        await ctx.reply("Channel soul overlay cleared.");
      } else {
        upsertChannelConfig(chatId, { soulOverlay: value });
        await refreshSessionContext(chatId);
        await ctx.reply(`Channel soul overlay set.`);
      }
      break;
    }

    case "preferences": {
      if (!value) {
        await ctx.reply("Usage: /channel preferences <text> or /channel preferences clear");
        return;
      }
      if (value === "clear") {
        upsertChannelConfig(chatId, { preferences: null });
        await refreshSessionContext(chatId);
        await ctx.reply("Channel preferences cleared.");
      } else {
        upsertChannelConfig(chatId, { preferences: value });
        await refreshSessionContext(chatId);
        await ctx.reply(`Channel preferences set.`);
      }
      break;
    }

    case "model": {
      if (!value) {
        return showChannelModelPicker(ctx, chatId);
      }
      if (value === "clear") {
        upsertChannelConfig(chatId, { defaultModel: null });
        await refreshSessionContext(chatId);
        await ctx.reply("Channel default model cleared.");
      } else {
        upsertChannelConfig(chatId, { defaultModel: value });
        await refreshSessionContext(chatId);
        const perChatOverride = getPerChatModelOverride(chatId);
        let reply = `Channel default model set to: ${value}`;
        if (perChatOverride) {
          reply += `\n⚠️ This chat has a per-chat override (\`${perChatOverride}\`) which takes precedence. Use /model to change or clear it.`;
        }
        await ctx.reply(reply, perChatOverride ? { parse_mode: "Markdown" } : undefined);
      }
      break;
    }

    case "reasoning": {
      if (!value) {
        return showChannelReasoningPicker(ctx, chatId);
      }
      if (value === "clear") {
        upsertChannelConfig(chatId, { defaultReasoningEffort: null });
        await refreshSessionContext(chatId);
        await ctx.reply("Channel default reasoning effort cleared.");
      } else if (!VALID_REASONING_EFFORTS.has(value)) {
        await ctx.reply(
          `Invalid reasoning effort: ${value}. Valid levels: ${[...VALID_REASONING_EFFORTS].join(", ")}`,
        );
      } else {
        const effectiveModel = getModelForChat(chatId);
        const info = await getModelReasoningInfo(effectiveModel);
        if (!info || !info.supported) {
          await ctx.reply(
            `Cannot set reasoning effort: the effective chat model (\`${effectiveModel}\`) does not support reasoning.`,
            { parse_mode: "Markdown" },
          );
        } else {
          upsertChannelConfig(chatId, { defaultReasoningEffort: value });
          await refreshSessionContext(chatId);
          await ctx.reply(`Channel default reasoning effort set to: ${value}`);
        }
      }
      break;
    }

    default:
      await ctx.reply(
        "Unknown subcommand. Usage:\n/channel — Show config\n/channel label <name>\n/channel topics <t1,t2,...>\n/channel topics clear\n/channel model [model-id]\n/channel model clear\n/channel reasoning [level]\n/channel reasoning clear\n/channel soul <text>\n/channel soul clear\n/channel preferences <text>\n/channel preferences clear",
      );
  }
}

async function showChannelConfig(ctx: Context, chatId: number) {
  const cfg = getChannelConfig(chatId);
  if (!cfg) {
    await ctx.reply(
      `Channel ${chatId}: No config set.\n\nUse /channel label <name> or /channel topics <t1,t2,...> to configure.`,
    );
    return;
  }

  const lines = [
    `Channel Config (${chatId})`,
    `Label: ${cfg.label || "(none)"}`,
    `Topics: ${cfg.topics || "(unrestricted)"}`,
    `Default Model: ${cfg.defaultModel || "(global)"}`,
    `Default Reasoning: ${cfg.defaultReasoningEffort || "(global)"}`,
    `Soul Overlay: ${cfg.soulOverlay ? `${cfg.soulOverlay.slice(0, 100)}...` : "(none)"}`,
    `Preferences: ${cfg.preferences ? `${cfg.preferences.slice(0, 100)}...` : "(none)"}`,
  ];

  await ctx.reply(lines.join("\n"));
}

// --- Channel Model Picker ---

interface ChannelModelPickerState {
  createdAt: number;
  chatId: number;
  currentDefault: string | null;
  fetchedAt: string;
  models: AvailableModel[];
  stale: boolean;
  providers: string[];
}

const channelModelPickers = new Map<string, ChannelModelPickerState>();

function pruneChannelModelPickers(now = Date.now()): void {
  for (const [id, picker] of channelModelPickers) {
    if (now - picker.createdAt > MODEL_PICKER_TTL_MS) channelModelPickers.delete(id);
  }
  while (channelModelPickers.size > MODEL_PICKER_MAX) {
    const oldest = channelModelPickers.keys().next().value;
    if (!oldest) break;
    channelModelPickers.delete(oldest);
  }
}

function createPickerId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function uniqueProviders(models: AvailableModel[]): string[] {
  const seen = new Set<string>();
  for (const m of models) {
    if (m.provider) seen.add(m.provider);
  }
  return [...seen];
}

function buildChannelModelPickerText(
  currentDefault: string | null,
  fetchedAt: string,
  page: number,
  totalPages: number,
  stale: boolean,
  providers: string[],
): string {
  const lines = [
    "Choose a default model for this channel.",
    `Current channel default: ${currentDefault || "(global)"}`,
  ];
  if (providers.length > 0) lines.push(`Providers: ${providers.join(", ")}`);
  lines.push(`Catalog fetched: ${fetchedAt}`);
  lines.push(`Page ${page + 1} of ${totalPages}`);
  if (stale) lines.push("Using stale cached catalog because GitHub refresh failed.");
  return lines.join("\n");
}

function buildChannelModelPickerMarkup(
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
    keyboard.text(left.label, `ch-model:set:${pickerId}:${startIndex + i}`);
    const right = pageModels[i + 1];
    if (right) {
      keyboard.text(right.label, `ch-model:set:${pickerId}:${startIndex + i + 1}`);
    }
    keyboard.row();
  }

  if (totalPages > 1) {
    if (safePage > 0) keyboard.text("Prev", `ch-model:page:${pickerId}:${safePage - 1}`);
    if (safePage < totalPages - 1)
      keyboard.text("Next", `ch-model:page:${pickerId}:${safePage + 1}`);
    keyboard.row();
  }

  keyboard.text("Clear default", `ch-model:clear:${pickerId}`);
  keyboard.text("Refresh", `ch-model:refresh:${pickerId}`);
  return keyboard;
}

function getChannelModelPickerMessage(pickerId: string, page: number) {
  const picker = channelModelPickers.get(pickerId);
  if (!picker) return null;

  const totalPages = Math.max(1, Math.ceil(picker.models.length / MODELS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);

  return {
    text: buildChannelModelPickerText(
      picker.currentDefault,
      picker.fetchedAt,
      safePage,
      totalPages,
      picker.stale,
      picker.providers,
    ),
    reply_markup: buildChannelModelPickerMarkup(pickerId, picker.models, safePage),
  };
}

async function showChannelModelPicker(ctx: Context, chatId: number) {
  try {
    const cfg = getChannelConfig(chatId);
    const catalog = await loadModelCatalog();
    pruneChannelModelPickers();
    const pickerId = createPickerId();
    channelModelPickers.set(pickerId, {
      createdAt: Date.now(),
      chatId,
      currentDefault: cfg?.defaultModel ?? null,
      fetchedAt: catalog.fetchedAt,
      models: catalog.models,
      stale: catalog.stale,
      providers: uniqueProviders(catalog.models),
    });

    const message = getChannelModelPickerMessage(pickerId, 0);
    if (!message) {
      await ctx.reply("Failed to build the model picker. Try again.");
      return;
    }
    await ctx.reply(message.text, { reply_markup: message.reply_markup });
  } catch (err) {
    await ctx.reply(`Failed to load available models: ${err}`);
  }
}

// --- Channel Reasoning Picker ---

interface ChannelReasoningPickerState {
  createdAt: number;
  chatId: number;
  levels: ReasoningEffort[];
  currentDefault: string | null;
}

const channelReasoningPickers = new Map<string, ChannelReasoningPickerState>();

function pruneChannelReasoningPickers(now = Date.now()): void {
  for (const [id, picker] of channelReasoningPickers) {
    if (now - picker.createdAt > MODEL_PICKER_TTL_MS) channelReasoningPickers.delete(id);
  }
  while (channelReasoningPickers.size > MODEL_PICKER_MAX) {
    const oldest = channelReasoningPickers.keys().next().value;
    if (!oldest) break;
    channelReasoningPickers.delete(oldest);
  }
}

function buildChannelReasoningPickerText(currentDefault: string | null, modelId: string): string {
  return [
    "Set default reasoning effort for this channel.",
    `Model: ${modelId}`,
    `Current channel default: ${currentDefault || "model default"}`,
  ].join("\n");
}

function buildChannelReasoningPickerMarkup(
  pickerId: string,
  levels: ReasoningEffort[],
  currentDefault: string | null,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < levels.length; i += 2) {
    const left = levels[i];
    const leftLabel = left === currentDefault ? `${left} ✓` : left;
    keyboard.text(leftLabel, `ch-reasoning:set:${pickerId}:${left}`);
    const right = levels[i + 1];
    if (right) {
      const rightLabel = right === currentDefault ? `${right} ✓` : right;
      keyboard.text(rightLabel, `ch-reasoning:set:${pickerId}:${right}`);
    }
    keyboard.row();
  }
  keyboard.text("Clear default", `ch-reasoning:clear:${pickerId}`);
  return keyboard;
}

async function showChannelReasoningPicker(ctx: Context, chatId: number) {
  const modelId = getModelForChat(chatId);
  const info = await getModelReasoningInfo(modelId);

  if (!info || !info.supported || info.levels.length === 0) {
    await ctx.reply(
      `The effective model (\`${modelId}\`) does not support reasoning effort configuration.`,
      { parse_mode: "Markdown" },
    );
    return;
  }

  pruneChannelReasoningPickers();
  const pickerId = createPickerId();
  const cfg = getChannelConfig(chatId);

  channelReasoningPickers.set(pickerId, {
    createdAt: Date.now(),
    chatId,
    levels: info.levels,
    currentDefault: cfg?.defaultReasoningEffort ?? null,
  });

  await ctx.reply(buildChannelReasoningPickerText(cfg?.defaultReasoningEffort ?? null, modelId), {
    reply_markup: buildChannelReasoningPickerMarkup(
      pickerId,
      info.levels,
      cfg?.defaultReasoningEffort ?? null,
    ),
  });
}

// --- Callback Routing ---

export function isChannelCallback(data: string | undefined): boolean {
  return (
    typeof data === "string" && (data.startsWith("ch-model:") || data.startsWith("ch-reasoning:"))
  );
}

function parseChannelModelCallback(
  data: string,
):
  | { action: "set"; pickerId: string; index: number }
  | { action: "page"; pickerId: string; page: number }
  | { action: "clear"; pickerId: string }
  | { action: "refresh"; pickerId: string }
  | null {
  const parts = data.split(":");
  if (parts[0] !== "ch-model") return null;

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
  if (parts[1] === "clear" && parts.length === 3) {
    return { action: "clear", pickerId: parts[2] };
  }
  if (parts[1] === "refresh" && parts.length === 3) {
    return { action: "refresh", pickerId: parts[2] };
  }
  return null;
}

function parseChannelReasoningCallback(
  data: string,
):
  | { action: "set"; pickerId: string; level: string }
  | { action: "clear"; pickerId: string }
  | null {
  const parts = data.split(":");
  if (parts[0] !== "ch-reasoning") return null;

  if (parts[1] === "set" && parts.length === 4) {
    return { action: "set", pickerId: parts[2], level: parts[3] };
  }
  if (parts[1] === "clear" && parts.length === 3) {
    return { action: "clear", pickerId: parts[2] };
  }
  return null;
}

export async function handleChannelCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) return false;

  if (data.startsWith("ch-model:")) return handleChannelModelCallback(ctx, data);
  if (data.startsWith("ch-reasoning:")) return handleChannelReasoningCallback(ctx, data);
  return false;
}

async function handleChannelModelCallback(ctx: Context, data: string): Promise<boolean> {
  const parsed = parseChannelModelCallback(data);
  if (!parsed) return false;

  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message) || !ctx.chat) {
    await ctx.answerCallbackQuery({ text: "This picker is no longer available." });
    return true;
  }

  const picker = channelModelPickers.get(parsed.pickerId);
  if (!picker) {
    await ctx.answerCallbackQuery({ text: "This picker expired. Use /channel model again." });
    return true;
  }

  try {
    if (parsed.action === "set") {
      const selected = picker.models[parsed.index];
      if (!selected) {
        await ctx.answerCallbackQuery({ text: "That model is no longer available." });
        return true;
      }
      upsertChannelConfig(picker.chatId, { defaultModel: selected.id });
      await refreshSessionContext(picker.chatId);
      channelModelPickers.delete(parsed.pickerId);

      await ctx.api.editMessageText(
        ctx.chat.id,
        message.message_id,
        `✅ Channel default model set to ${selected.id}.`,
      );
      await ctx.answerCallbackQuery({ text: `Set to ${selected.id}` });
      return true;
    }

    if (parsed.action === "clear") {
      upsertChannelConfig(picker.chatId, { defaultModel: null });
      await refreshSessionContext(picker.chatId);
      channelModelPickers.delete(parsed.pickerId);

      await ctx.api.editMessageText(
        ctx.chat.id,
        message.message_id,
        "Channel default model cleared. Using global default.",
      );
      await ctx.answerCallbackQuery({ text: "Cleared" });
      return true;
    }

    if (parsed.action === "refresh") {
      const catalog = await loadModelCatalog({ forceRefresh: true });
      picker.models = catalog.models;
      picker.fetchedAt = catalog.fetchedAt;
      picker.stale = catalog.stale;
      picker.providers = uniqueProviders(catalog.models);

      const next = getChannelModelPickerMessage(parsed.pickerId, 0);
      if (next) {
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, next.text, {
          reply_markup: next.reply_markup,
        });
      }
      await ctx.answerCallbackQuery({ text: "Model list refreshed." });
      return true;
    }

    // page
    const next = getChannelModelPickerMessage(parsed.pickerId, parsed.page);
    if (next) {
      await ctx.api.editMessageText(ctx.chat.id, message.message_id, next.text, {
        reply_markup: next.reply_markup,
      });
    }
    await ctx.answerCallbackQuery();
    return true;
  } catch {
    await ctx.answerCallbackQuery({ text: "Action failed. Try /channel model again." });
    return true;
  }
}

async function handleChannelReasoningCallback(ctx: Context, data: string): Promise<boolean> {
  const parsed = parseChannelReasoningCallback(data);
  if (!parsed) return false;

  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message) || !ctx.chat) {
    await ctx.answerCallbackQuery({ text: "This picker is no longer available." });
    return true;
  }

  const picker = channelReasoningPickers.get(parsed.pickerId);
  if (!picker) {
    await ctx.answerCallbackQuery({ text: "This picker expired. Use /channel reasoning again." });
    return true;
  }

  try {
    if (parsed.action === "set") {
      if (!picker.levels.includes(parsed.level as ReasoningEffort)) {
        await ctx.answerCallbackQuery({ text: "That level is no longer available." });
        return true;
      }
      upsertChannelConfig(picker.chatId, { defaultReasoningEffort: parsed.level });
      await refreshSessionContext(picker.chatId);
      channelReasoningPickers.delete(parsed.pickerId);

      await ctx.api.editMessageText(
        ctx.chat.id,
        message.message_id,
        `Channel default reasoning effort set to ${parsed.level}.`,
      );
      await ctx.answerCallbackQuery({ text: `Set to ${parsed.level}` });
      return true;
    }

    if (parsed.action === "clear") {
      upsertChannelConfig(picker.chatId, { defaultReasoningEffort: null });
      await refreshSessionContext(picker.chatId);
      channelReasoningPickers.delete(parsed.pickerId);

      await ctx.api.editMessageText(
        ctx.chat.id,
        message.message_id,
        "Channel default reasoning effort cleared. Using model default.",
      );
      await ctx.answerCallbackQuery({ text: "Cleared" });
      return true;
    }
  } catch {
    await ctx.answerCallbackQuery({ text: "Action failed. Try /channel reasoning again." });
    return true;
  }

  return false;
}
