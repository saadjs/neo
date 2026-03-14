import { InputFile, type Api } from "grammy";
import { getLogger } from "../logging/index.js";

let telegramApi: Api | null = null;

export function setTelegramApi(api: Api): void {
  telegramApi = api;
}

export function getTelegramApi(): Api | null {
  return telegramApi;
}

export async function sendPhotoFromPath(chatId: number, path: string, caption?: string) {
  const api = getTelegramApi();
  if (!api) {
    throw new Error("Telegram API not initialized");
  }

  getLogger().info({ chatId, path }, "Sending screenshot to Telegram");
  return api.sendPhoto(chatId, new InputFile(path), caption ? { caption } : undefined);
}
