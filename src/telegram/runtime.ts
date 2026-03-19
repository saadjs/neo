import type { TelegramTransport } from "../transport/telegram";
import { getTransport, registerTransport } from "../transport/notifier";

let telegramTransport: TelegramTransport | null = null;

export function setTelegramTransport(transport: TelegramTransport): void {
  telegramTransport = transport;
  registerTransport(transport);
}

export function getTelegramTransport(): TelegramTransport | null {
  return telegramTransport ?? (getTransport("telegram") as TelegramTransport | undefined) ?? null;
}
