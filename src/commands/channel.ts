import type { Context } from "grammy";
import { config } from "../config";
import { VALID_REASONING_EFFORTS } from "../constants";
import { getChannelConfig, upsertChannelConfig } from "../memory/db";
import { getModelForChat, getPerChatModelOverride, refreshSessionContext } from "../agent";
import { getModelReasoningInfo } from "./model-catalog";

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

    case "model": {
      if (!value) {
        await ctx.reply("Usage: /channel model <model-id> or /channel model clear");
        return;
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
        await ctx.reply("Usage: /channel reasoning <level> or /channel reasoning clear");
        return;
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
        "Unknown subcommand. Usage:\n/channel — Show config\n/channel label <name>\n/channel topics <t1,t2,...>\n/channel topics clear\n/channel model <model-id>\n/channel model clear\n/channel reasoning <level>\n/channel reasoning clear",
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
