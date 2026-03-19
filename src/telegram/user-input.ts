import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getLogger } from "../logging/index";
import { getTransport } from "../transport/notifier";
import {
  cancelPendingUserInput as cancelPendingUserInputGeneric,
  cancelPendingUserInputForSession as cancelPendingUserInputForSessionGeneric,
  getPendingUserInput as getPendingUserInputGeneric,
  requestUserInput as requestUserInputGeneric,
  resolvePendingUserInput as resolvePendingUserInputGeneric,
  watchPendingUserInput as watchPendingUserInputGeneric,
} from "../transport/user-input";
import type {
  OutboundTransport,
  UserInputPromptPayload,
  UserInputResponse,
} from "../transport/types";
import {
  createTelegramConversationRef,
  createTelegramConversationRefFromId,
} from "../transport/telegram-utils";

interface TelegramUserInputRequest {
  question: string;
  choices?: string[];
  allowFreeform?: boolean;
}

function getTelegramUserInputTransport(): OutboundTransport {
  const transport = getTransport("telegram");
  if (!transport) {
    throw new Error("Telegram transport not initialized for ask_user.");
  }
  return transport;
}

export function buildQuestionMessage(request: TelegramUserInputRequest): string {
  const lines = ["Need your input to continue:", "", request.question.trim()];

  if (request.choices?.length && request.allowFreeform === false) {
    lines.push("", "Choose one below.");
  } else if (request.choices?.length) {
    lines.push("", "Choose one below or reply with your own answer.");
  } else {
    lines.push("", "Reply with your answer in your next text message.");
  }

  return lines.join("\n");
}

export function buildChoicesMarkup(requestId: string, choices: string[]) {
  return InlineKeyboard.from(
    choices.map((choice, index) => [InlineKeyboard.text(choice, `ask:${requestId}:${index}`)]),
  );
}

function parseUserInputCallbackData(
  data: string,
): { requestId: string; choiceIndex: number } | null {
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== "ask") return null;

  const choiceIndex = Number(parts[2]);
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0) return null;

  return { requestId: parts[1], choiceIndex };
}

export function isUserInputCallback(data: string | undefined): boolean {
  return typeof data === "string" && data.startsWith("ask:");
}

async function clearPromptReplyMarkup(ctx: Context, messageId: number): Promise<void> {
  try {
    await ctx.api.editMessageReplyMarkup(ctx.chat!.id, messageId, {
      reply_markup: new InlineKeyboard(),
    });
  } catch (err) {
    getLogger().warn(
      { err, chatId: ctx.chat?.id, messageId },
      "Failed to clear ask_user prompt markup",
    );
  }
}

async function safeAnswerCallbackQuery(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery({ text });
  } catch (err) {
    getLogger().warn({ err, chatId: ctx.chat?.id }, "Failed to answer ask_user callback query");
  }
}

export async function requestUserInput(
  chatId: string,
  sessionId: string,
  request: TelegramUserInputRequest,
): Promise<UserInputResponse> {
  return requestUserInputGeneric({
    conversation: createTelegramConversationRefFromId(chatId),
    sessionId,
    transport: getTelegramUserInputTransport(),
    request,
  });
}

export function getPendingUserInput(chatId: string) {
  return getPendingUserInputGeneric(createTelegramConversationRefFromId(chatId));
}

export function watchPendingUserInput(
  chatId: string,
  handler: Parameters<typeof watchPendingUserInputGeneric>[1],
) {
  return watchPendingUserInputGeneric(createTelegramConversationRefFromId(chatId), handler);
}

export function resolvePendingUserInput(
  chatId: string,
  answer: string,
): UserInputResponse | undefined {
  return resolvePendingUserInputGeneric(createTelegramConversationRefFromId(chatId), answer);
}

export async function cancelPendingUserInput(
  chatId: string,
  reason: string,
  opts?: { notifyUser?: boolean },
): Promise<boolean> {
  return cancelPendingUserInputGeneric(createTelegramConversationRefFromId(chatId), reason, opts);
}

export async function cancelPendingUserInputForSession(
  chatId: string,
  sessionId: string,
  reason: string,
  opts?: { notifyUser?: boolean },
): Promise<boolean> {
  return cancelPendingUserInputForSessionGeneric(
    createTelegramConversationRefFromId(chatId),
    sessionId,
    reason,
    opts,
  );
}

export async function handleUserInputCallback(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;
  const data = callbackQuery?.data;
  const parsed = data ? parseUserInputCallbackData(data) : null;

  if (!callbackQuery || !parsed) {
    return false;
  }

  const message = callbackQuery.message;

  if (!ctx.chat || !message || !("message_id" in message)) {
    if (ctx.chat && message && "message_id" in message) {
      await clearPromptReplyMarkup(ctx, message.message_id);
    }
    await safeAnswerCallbackQuery(ctx, "This prompt is no longer active.");
    return true;
  }

  const conversation = createTelegramConversationRef(ctx.chat);
  const pending = getPendingUserInputGeneric(conversation);

  if (!pending) {
    await clearPromptReplyMarkup(ctx, message.message_id);
    await safeAnswerCallbackQuery(ctx, "This prompt is no longer active.");
    return true;
  }

  if (
    pending.requestId !== parsed.requestId ||
    (pending.promptHandle && pending.promptHandle.id !== String(message.message_id))
  ) {
    await clearPromptReplyMarkup(ctx, message.message_id);
    await safeAnswerCallbackQuery(ctx, "This prompt expired. Please use the latest one.");
    return true;
  }

  const choice = pending.choices?.[parsed.choiceIndex];
  if (!choice) {
    await clearPromptReplyMarkup(ctx, message.message_id);
    await safeAnswerCallbackQuery(ctx, "That option is no longer available.");
    return true;
  }

  getLogger().info({ chatId: ctx.chat.id, choice }, "ask_user choice selected");
  resolvePendingUserInputGeneric(conversation, choice);

  await clearPromptReplyMarkup(ctx, message.message_id);
  await safeAnswerCallbackQuery(ctx, `Selected: ${choice}`);
  return true;
}

export type { UserInputPromptPayload };
