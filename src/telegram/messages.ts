import { TELEGRAM_MSG_LIMIT } from "../constants.js";

export function truncateTelegramMessage(text: string, omission = "…"): string {
  if (text.length <= TELEGRAM_MSG_LIMIT) return text;
  const maxLength = Math.max(0, TELEGRAM_MSG_LIMIT - omission.length);
  return `${text.slice(0, maxLength)}${omission}`;
}

export function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MSG_LIMIT) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MSG_LIMIT) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline near the limit
    let splitIdx = remaining.lastIndexOf("\n", TELEGRAM_MSG_LIMIT);
    if (splitIdx < TELEGRAM_MSG_LIMIT * 0.5) {
      // No good newline break — split at space
      splitIdx = remaining.lastIndexOf(" ", TELEGRAM_MSG_LIMIT);
    }
    if (splitIdx < TELEGRAM_MSG_LIMIT * 0.5) {
      // No good break at all — hard split
      splitIdx = TELEGRAM_MSG_LIMIT;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}
