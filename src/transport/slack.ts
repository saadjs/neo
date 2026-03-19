import type {
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

export class SlackTransport implements OutboundTransport {
  readonly platform: Platform = "slack";
  readonly capabilities: TransportCapabilities = {
    editableMessages: true,
    typingIndicators: false,
    commands: true,
    interactiveInput: true,
    photoDelivery: true,
    voiceMessages: false,
  };

  private unsupported(method: string): never {
    throw new Error(`SlackTransport.${method} is not implemented yet.`);
  }

  async sendText(
    _conversation: ConversationRef,
    _text: string,
    _opts?: OutboundTextOptions,
  ): Promise<TransportMessageHandle> {
    this.unsupported("sendText");
  }

  async editText(
    _conversation: ConversationRef,
    _message: TransportMessageHandle,
    _text: string,
    _opts?: OutboundTextOptions,
  ): Promise<void> {
    this.unsupported("editText");
  }

  async deleteMessage(
    _conversation: ConversationRef,
    _message: TransportMessageHandle,
  ): Promise<void> {
    this.unsupported("deleteMessage");
  }

  async indicateTyping(_conversation: ConversationRef): Promise<void> {
    this.unsupported("indicateTyping");
  }

  async sendPhoto(
    _conversation: ConversationRef,
    _path: string,
    _opts?: SendPhotoOptions,
  ): Promise<TransportMessageHandle> {
    this.unsupported("sendPhoto");
  }

  async requestUserInput(
    _conversation: ConversationRef,
    _prompt: UserInputPromptPayload,
  ): Promise<UserInputPromptHandle | undefined> {
    this.unsupported("requestUserInput");
  }

  async clearUserInputPrompt(
    _conversation: ConversationRef,
    _prompt: UserInputPromptHandle,
  ): Promise<void> {
    this.unsupported("clearUserInputPrompt");
  }

  isEditNoOp(_err: unknown): boolean {
    return false;
  }

  isEditTargetGone(_err: unknown): boolean {
    return false;
  }
}
