import type { RunnerHandle } from "@grammyjs/runner";
import { setTelegramTransport } from "./telegram/runtime";
import { TelegramTransport } from "./transport/telegram";

export interface BotHandle {
  api: TelegramTransport["api"];
  runner: RunnerHandle;
  transport: TelegramTransport;
}

export async function createBot(): Promise<BotHandle> {
  const transport = new TelegramTransport();
  setTelegramTransport(transport);
  const handle = await transport.start();
  return {
    api: handle.api,
    runner: handle.runner,
    transport,
  };
}
