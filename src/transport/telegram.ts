import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import { run, type RunnerHandle } from "@grammyjs/runner";
import { config } from "../config";
import { getLogger } from "../logging/index";
import { registerCommands } from "../commands/index";
import { handleModelCallback, isModelCallback } from "../commands/model";
import { handleReasoningCallback, isReasoningCallback } from "../commands/reasoning";
import { handleSessionCallback, isSessionCallback } from "../commands/session";
import { handleJobsCallback, isJobsCallback } from "../commands/jobs";
import { downloadTelegramFile } from "../telegram/files";
import { isVoiceEnabled, transcribeFile } from "../voice/transcribe";
import { LOG_TRANSCRIPT_MAX_CHARS } from "../constants";
import { handleRuntimeMessage } from "../runtime/chat-runtime";
import {
  buildChoicesMarkup,
  buildQuestionMessage,
  getPendingUserInput,
  handleUserInputCallback,
  isUserInputCallback,
  resolvePendingUserInput,
} from "../telegram/user-input";
import type {
  AttachmentRef,
  ConversationRef,
  OutboundTextOptions,
  Platform,
  SendPhotoOptions,
  TransportCapabilities,
  TransportMessageHandle,
  UserInputPromptHandle,
  UserInputPromptPayload,
  OutboundTransport,
} from "./types";
import { createTelegramConversationRef, getTelegramChatId } from "./telegram-utils";

export interface TelegramTransportHandle {
  transport: TelegramTransport;
  runner: RunnerHandle;
  api: Bot["api"];
}

export class TelegramTransport implements OutboundTransport {
  readonly platform: Platform = "telegram";
  readonly capabilities: TransportCapabilities = {
    editableMessages: true,
    typingIndicators: true,
    commands: true,
    interactiveInput: true,
    photoDelivery: true,
    voiceMessages: true,
  };

  private readonly bot: Bot;

  constructor() {
    this.bot = new Bot(config.telegram.botToken);
  }

  get api() {
    return this.bot.api;
  }

  async start(): Promise<TelegramTransportHandle> {
    const log = getLogger();

    this.bot.use(async (ctx, next) => {
      const chatType = ctx.chat?.type;
      const isGroupChat = chatType === "group" || chatType === "supergroup";
      if (!isGroupChat && ctx.from?.id !== config.telegram.ownerId) return;
      await next();
    });

    await registerCommands(this.bot);

    this.bot.on("callback_query:data", async (ctx) => {
      if (isUserInputCallback(ctx.callbackQuery.data)) {
        await handleUserInputCallback(ctx);
        return;
      }
      if (isReasoningCallback(ctx.callbackQuery.data)) {
        await handleReasoningCallback(ctx);
        return;
      }
      if (isSessionCallback(ctx.callbackQuery.data)) {
        await handleSessionCallback(ctx);
        return;
      }
      if (isJobsCallback(ctx.callbackQuery.data)) {
        await handleJobsCallback(ctx);
        return;
      }
      if (!isModelCallback(ctx.callbackQuery.data)) return;
      await handleModelCallback(ctx);
    });

    this.bot.on("message:text", async (ctx) => {
      const text = ctx.message.text;
      const pendingInput = getPendingUserInput(String(ctx.chat!.id));
      if (pendingInput) {
        const response = resolvePendingUserInput(String(ctx.chat!.id), text);
        if (response) {
          await ctx.reply("Resuming task…");
        } else {
          await ctx.reply(
            "That answer doesn't match the allowed choices. Tap one of the buttons on the pending prompt.",
          );
        }
        return;
      }

      if (text.startsWith("/")) return;
      await this.handleMessage(ctx, text);
    });

    this.bot.on("message:photo", async (ctx) => {
      if (await this.replyIfWaitingForTextAnswer(ctx)) return;

      const caption = ctx.message.caption ?? "What's in this image?";
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];

      try {
        const localPath = await downloadTelegramFile(ctx.api, largest.file_id);
        await this.handleMessage(ctx, caption, [
          { kind: "image", path: localPath, sourceId: largest.file_id },
        ]);
      } catch (err) {
        log.error({ err }, "Failed to download photo");
        await ctx.reply("Failed to download the photo. Please try again.");
      }
    });

    this.bot.on("message:document", async (ctx) => {
      if (await this.replyIfWaitingForTextAnswer(ctx)) return;

      const doc = ctx.message.document;
      const caption = ctx.message.caption ?? `I sent you a file: ${doc.file_name ?? "unknown"}`;

      try {
        const localPath = await downloadTelegramFile(
          ctx.api,
          doc.file_id,
          doc.file_name ?? undefined,
        );
        await this.handleMessage(ctx, caption, [
          {
            kind: "file",
            path: localPath,
            fileName: doc.file_name ?? undefined,
            sourceId: doc.file_id,
            mimeType: doc.mime_type ?? undefined,
          },
        ]);
      } catch (err) {
        log.error({ err }, "Failed to download document");
        await ctx.reply("Failed to download the file. Please try again.");
      }
    });

    this.bot.on("message:voice", async (ctx) => {
      if (await this.replyIfWaitingForTextAnswer(ctx)) return;

      if (!isVoiceEnabled()) {
        await ctx.reply("Voice messages are not configured. Set DEEPGRAM_API_KEY to enable.");
        return;
      }

      try {
        const localPath = await downloadTelegramFile(
          ctx.api,
          ctx.message.voice.file_id,
          "voice.ogg",
        );
        const transcript = await transcribeFile(localPath);

        if (!transcript.trim()) {
          await ctx.reply("Couldn't make out what you said. Try again?");
          return;
        }

        log.info(
          { chatId: ctx.chat!.id, transcript: transcript.slice(0, LOG_TRANSCRIPT_MAX_CHARS) },
          "Voice transcribed",
        );
        await this.handleMessage(ctx, transcript);
      } catch (err) {
        log.error({ err }, "Failed to process voice message");
        await ctx.reply("Failed to process the voice message. Please try again.");
      }
    });

    this.bot.catch((err) => {
      log.error({ err: err.error, ctx: err.ctx?.update?.update_id }, "Bot error");
    });

    const runner = run(this.bot);
    log.info("Telegram bot started (transport adapter)");

    return {
      transport: this,
      runner,
      api: this.bot.api,
    };
  }

  async sendText(
    conversation: ConversationRef,
    text: string,
    opts?: OutboundTextOptions,
  ): Promise<TransportMessageHandle> {
    const chatId = getTelegramChatId(conversation);
    const format = opts?.format;
    if (format === "markdown") {
      try {
        const message = await this.bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" });
        return { id: String(message.message_id) };
      } catch {
        const message = await this.bot.api.sendMessage(chatId, text);
        return { id: String(message.message_id) };
      }
    }

    const message = await this.bot.api.sendMessage(chatId, text);
    return { id: String(message.message_id) };
  }

  async editText(
    conversation: ConversationRef,
    message: TransportMessageHandle,
    text: string,
    opts?: OutboundTextOptions,
  ): Promise<void> {
    const chatId = getTelegramChatId(conversation);
    const messageId = Number(message.id);
    if (opts?.format === "markdown") {
      await this.bot.api.editMessageText(chatId, messageId, text, { parse_mode: "Markdown" });
      return;
    }
    await this.bot.api.editMessageText(chatId, messageId, text);
  }

  async deleteMessage(
    conversation: ConversationRef,
    message: TransportMessageHandle,
  ): Promise<void> {
    await this.bot.api.deleteMessage(getTelegramChatId(conversation), Number(message.id));
  }

  async indicateTyping(conversation: ConversationRef): Promise<void> {
    await this.bot.api.sendChatAction(getTelegramChatId(conversation), "typing");
  }

  async sendPhoto(
    conversation: ConversationRef,
    path: string,
    opts?: SendPhotoOptions,
  ): Promise<TransportMessageHandle> {
    const message = await this.bot.api.sendPhoto(
      getTelegramChatId(conversation),
      new InputFile(path),
      opts?.caption ? { caption: opts.caption } : undefined,
    );
    return { id: String(message.message_id) };
  }

  async requestUserInput(
    conversation: ConversationRef,
    prompt: UserInputPromptPayload,
  ): Promise<UserInputPromptHandle | undefined> {
    const chatId = getTelegramChatId(conversation);
    const options = prompt.choices?.length
      ? { reply_markup: buildChoicesMarkup(prompt.requestId, prompt.choices) }
      : undefined;
    const message = await this.bot.api.sendMessage(chatId, buildQuestionMessage(prompt), options);
    return { id: String(message.message_id) };
  }

  async clearUserInputPrompt(
    conversation: ConversationRef,
    prompt: UserInputPromptHandle,
  ): Promise<void> {
    await this.bot.api.editMessageReplyMarkup(getTelegramChatId(conversation), Number(prompt.id), {
      reply_markup: new InlineKeyboard(),
    });
  }

  private async handleMessage(ctx: Context, text: string, attachments?: AttachmentRef[]) {
    await handleRuntimeMessage(this, {
      conversation: createTelegramConversationRef(ctx.chat!),
      text,
      attachments,
    });
  }

  private async replyIfWaitingForTextAnswer(ctx: Context): Promise<boolean> {
    if (!getPendingUserInput(String(ctx.chat!.id))) return false;

    await ctx.reply("I’m waiting for a text answer to the pending question before I can continue.");
    return true;
  }
}
