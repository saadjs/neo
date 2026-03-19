import type { Context } from "grammy";
import { config } from "../config";
import { getChannelConfig, upsertChannelConfig } from "../memory/db";
import { refreshSessionContext } from "../agent";

export async function handleChannel(ctx: Context) {
  const chatId = String(ctx.chat!.id);

  if (chatId === String(config.telegram.ownerId)) {
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

    default:
      await ctx.reply(
        "Unknown subcommand. Usage:\n/channel — Show config\n/channel label <name>\n/channel topics <t1,t2,...>\n/channel topics clear",
      );
  }
}

async function showChannelConfig(ctx: Context, chatId: string) {
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
    `Soul Overlay: ${cfg.soulOverlay ? `${cfg.soulOverlay.slice(0, 100)}...` : "(none)"}`,
    `Preferences: ${cfg.preferences ? `${cfg.preferences.slice(0, 100)}...` : "(none)"}`,
  ];

  await ctx.reply(lines.join("\n"));
}
