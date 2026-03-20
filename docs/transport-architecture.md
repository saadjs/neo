# Transport Architecture

Neo now separates assistant orchestration from message delivery so the same core runtime can be reused across multiple chat platforms.

## Layers

### 1. Core assistant runtime

`src/runtime/chat-runtime.ts` owns the platform-neutral assistant turn lifecycle:

- session creation and reuse
- streaming/progress updates
- tool-call logging
- compaction persistence
- cancellation/error handling
- final response delivery through a transport interface

This module works with normalized `ConversationRef` values plus the `OutboundTransport` contract in `src/transport/types.ts`.

### 2. Transport adapters

`src/transport/telegram.ts` is the first concrete adapter. It is responsible for:

- starting grammY
- translating Telegram updates into normalized conversations + attachments
- registering Telegram slash commands and callback handlers
- downloading Telegram files before forwarding them to the core runtime
- implementing outbound text/photo/edit/delete/typing operations
- rendering `ask_user` prompts with inline keyboards

Discord and Slack adapters are not included yet. When ready, each should implement `OutboundTransport` and register itself at startup.

### 3. Shared transport services

- `src/transport/user-input.ts` stores pending interactive prompts keyed by normalized conversation identity instead of raw Telegram chat ids.
- `src/transport/notifier.ts` routes scheduler/startup/browser notifications through registered transports instead of calling Telegram APIs directly.
- `src/transport/telegram-utils.ts` contains Telegram-specific conversation helpers so Telegram ids do not leak through the rest of the transport layer.

## Normalized concepts

The transport layer centers on a few practical types from `src/transport/types.ts`:

- `ConversationRef` — platform, conversation id, and DM/group/channel kind
- `UserRef` / `MessageRef` — normalized sender and message identity
- `AttachmentRef` — downloaded local attachment metadata
- `OutboundTransport` — capability-oriented outbound API for sending/editing/deleting messages, typing indicators, photos, and interactive prompts

The abstraction is intentionally modest: it focuses on the operations Neo already needs instead of mirroring every Telegram API concept.

## Telegram wiring

At startup (`src/index.ts`):

1. Neo creates the Telegram adapter through `createBot()`.
2. The adapter is registered with the notifier/runtime compatibility layer.
3. Scheduler notifications and restart/onboarding messages use the notifier service.

During a Telegram message turn:

1. `TelegramTransport` receives a grammY update.
2. Telegram files are downloaded if necessary.
3. The adapter builds a normalized `ConversationRef` and attachment list.
4. `handleRuntimeMessage()` runs the assistant turn.
5. All progress/final output is sent back through the transport interface.

## ask_user flow

The `ask_user` bridge now has two parts:

- generic registry: `src/transport/user-input.ts`
- Telegram rendering + callback parsing: `src/telegram/user-input.ts`

The registry is conversation-keyed, so Discord and Slack can reuse the same pending-input lifecycle while swapping in platform-native prompt delivery.

## Notifications and screenshots

Scheduler reminders, scheduled jobs, restart messages, onboarding messages, and browser screenshots now send through `src/transport/notifier.ts`.

That keeps the core services transport-agnostic and gives future adapters a clear place to register channel or DM destinations.

## What Discord needs next

A Discord adapter should:

1. implement `OutboundTransport`
2. normalize Discord DMs/channels/threads into `ConversationRef`
3. map slash commands + component interactions into the existing command/action entry points
4. implement Discord-native `ask_user` prompt delivery (buttons, selects, or modal fallback)
5. register itself with `registerTransport()` at startup

## What Slack needs next

A Slack adapter should:

1. implement `OutboundTransport`
2. normalize Slack IMs/channels/threads into `ConversationRef`
3. map Slack slash commands and interactive actions into the shared command layer
4. implement prompt delivery using buttons, modals, or thread replies
5. register itself with `registerTransport()` so notifications can target Slack conversations

## Current limitation

The Copilot session/memory model is still keyed by Neo's current numeric chat scope because channel overlays and session persistence already depend on those ids. The transport layer isolates delivery cleanly today, and the remaining work for full cross-platform session identity is mostly in `src/agent.ts` and memory/session persistence rather than the new transport boundary.
