import type { ConversationRef, NotificationTarget, OutboundTransport } from "./types";

const transports = new Map<string, OutboundTransport>();

export function registerTransport(transport: OutboundTransport): void {
  transports.set(transport.platform, transport);
}

export function unregisterTransport(platform: string): void {
  transports.delete(platform);
}

export function getTransport(platform: string): OutboundTransport | undefined {
  return transports.get(platform);
}

function requireTransport(conversation: ConversationRef): OutboundTransport {
  const transport = transports.get(conversation.platform);
  if (!transport) {
    throw new Error(`No transport registered for ${conversation.platform}.`);
  }
  return transport;
}

export async function notifyText(target: NotificationTarget, text: string): Promise<void> {
  await requireTransport(target.conversation).sendText(target.conversation, text);
}

export async function notifyPhoto(
  target: NotificationTarget,
  path: string,
  caption?: string,
): Promise<void> {
  await requireTransport(target.conversation).sendPhoto(target.conversation, path, { caption });
}
