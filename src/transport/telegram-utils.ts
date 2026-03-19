import type { ConversationRef } from "./types";

export function getTelegramConversationKind(chatType?: string): ConversationRef["kind"] {
  if (chatType === "group" || chatType === "supergroup") return "group";
  if (chatType === "channel") return "channel";
  return "dm";
}

export function createTelegramConversationRef(chat: {
  id: number;
  type?: string;
  title?: string;
  username?: string;
}): ConversationRef {
  return {
    platform: "telegram",
    id: String(chat.id),
    kind: getTelegramConversationKind(chat.type),
    title: chat.title ?? chat.username,
    metadata: {
      telegramChatId: chat.id,
      sessionScopeId: chat.id,
      telegramChatType: chat.type,
    },
  };
}

// Telegram-specific: group/channel chat IDs are negative (start with "-")
export function isChannelChat(chatId: string): boolean {
  return chatId.startsWith("-");
}

export function createTelegramConversationRefFromId(chatId: string): ConversationRef {
  return {
    platform: "telegram",
    id: chatId,
    kind: "dm",
    metadata: { sessionScopeId: chatId },
  };
}

export function getTelegramChatId(conversation: ConversationRef): number {
  const chatId = conversation.metadata?.telegramChatId;
  if (typeof chatId === "number") return chatId;

  const parsed = Number(conversation.id);
  if (Number.isInteger(parsed)) return parsed;

  throw new Error(`Conversation ${conversation.id} is not a Telegram chat id.`);
}
