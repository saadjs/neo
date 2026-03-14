import type { Context } from "grammy";
import { formatSystemStatusSummary, getSystemStatus } from "../runtime/state.js";

export async function handleStatus(ctx: Context) {
  const status = await getSystemStatus();
  await ctx.reply(formatSystemStatusSummary(status));
}
