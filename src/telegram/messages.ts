import { TELEGRAM_MSG_LIMIT } from "../constants";
import { splitMessage as splitGeneric } from "../runtime/messages";

export function truncateTelegramMessage(text: string, omission = "…"): string {
  if (text.length <= TELEGRAM_MSG_LIMIT) return text;
  const maxLength = Math.max(0, TELEGRAM_MSG_LIMIT - omission.length);
  return `${text.slice(0, maxLength)}${omission}`;
}

export function splitMessage(text: string): string[] {
  return splitGeneric(text, TELEGRAM_MSG_LIMIT);
}
