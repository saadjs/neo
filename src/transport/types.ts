export type Platform = "telegram" | "discord" | "slack";

export type ConversationKind = "dm" | "group" | "channel";

export interface ConversationRef {
  platform: Platform;
  id: string;
  kind: ConversationKind;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface UserRef {
  id: string;
  username?: string;
  displayName?: string;
  isBot?: boolean;
  metadata?: Record<string, unknown>;
}

export interface MessageRef {
  id: string;
  replyToId?: string;
}

export interface AttachmentRef {
  kind: "image" | "file" | "audio";
  path: string;
  fileName?: string;
  mimeType?: string;
  sourceId?: string;
}

export interface TransportMessageHandle {
  id: string;
}

export interface UserInputRequest {
  question: string;
  choices?: string[];
  allowFreeform?: boolean;
}

export interface UserInputResponse {
  answer: string;
  wasFreeform: boolean;
}

export interface UserInputPromptHandle {
  id: string;
}

export interface UserInputPromptPayload {
  requestId: string;
  question: string;
  choices?: string[];
  allowFreeform: boolean;
}

export interface OutboundTextOptions {
  format?: "markdown" | "plain";
}

export interface SendPhotoOptions {
  caption?: string;
}

export interface InboundMessageEvent {
  type: "message";
  conversation: ConversationRef;
  user: UserRef;
  message: MessageRef;
  text: string;
  attachments?: AttachmentRef[];
}

export interface InboundCommandEvent {
  type: "command";
  conversation: ConversationRef;
  user: UserRef;
  message: MessageRef;
  command: string;
  args: string;
}

export interface InboundActionEvent {
  type: "action";
  conversation: ConversationRef;
  user: UserRef;
  message?: MessageRef;
  actionId: string;
  data: string;
}

export type InboundEvent = InboundMessageEvent | InboundCommandEvent | InboundActionEvent;

export interface TransportCapabilities {
  editableMessages: boolean;
  typingIndicators: boolean;
  commands: boolean;
  interactiveInput: boolean;
  photoDelivery: boolean;
  voiceMessages: boolean;
  maxMessageLength?: number;
}

export interface OutboundTransport {
  readonly platform: Platform;
  readonly capabilities: TransportCapabilities;
  sendText(
    conversation: ConversationRef,
    text: string,
    opts?: OutboundTextOptions,
  ): Promise<TransportMessageHandle>;
  editText(
    conversation: ConversationRef,
    message: TransportMessageHandle,
    text: string,
    opts?: OutboundTextOptions,
  ): Promise<void>;
  deleteMessage(conversation: ConversationRef, message: TransportMessageHandle): Promise<void>;
  indicateTyping(conversation: ConversationRef): Promise<void>;
  sendPhoto(
    conversation: ConversationRef,
    path: string,
    opts?: SendPhotoOptions,
  ): Promise<TransportMessageHandle>;
  requestUserInput(
    conversation: ConversationRef,
    prompt: UserInputPromptPayload,
  ): Promise<UserInputPromptHandle | undefined>;
  clearUserInputPrompt(conversation: ConversationRef, prompt: UserInputPromptHandle): Promise<void>;
  isEditNoOp?(err: unknown): boolean;
  isEditTargetGone?(err: unknown): boolean;
}

export interface NotificationTarget {
  conversation: ConversationRef;
}

export function buildConversationKey(conversation: ConversationRef): string {
  return `${conversation.platform}:${conversation.id}`;
}
