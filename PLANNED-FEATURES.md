# Planned Features

Planned work for Neo: SDK capabilities available for integration, plus custom features not provided out of the box.

See [`copilot-cli-sdk-reference.md`](./copilot-cli-sdk-reference.md) for build-vs-configure decisions.

> The Copilot SDK is in **Technical Preview** — re-validate against the latest release before implementing SDK items.

---

## Wire from the SDK

SDK capabilities already available for Telegram integration.

### - [x] `/cancel` — `session.abort()`

Implemented. `/cancel` calls `abort()` on the active session to stop the in-flight turn without destroying the session. Partial responses are suppressed via an abort flag consumed by `handleMessage` in `bot.ts`. Handles no-session and no-active-turn cases gracefully.

### - [ ] Streaming responses

Neo waits for `session.idle` before showing anything. Enable `streaming: true` in `buildSessionConfig()`, subscribe to `assistant.message_delta` events in `bot.ts`, buffer deltas, and periodically edit the Telegram progress message with partial content. Debounce edits aggressively — Telegram rate-limits `editMessageText`. Partial markdown will break mid-stream; send raw text while streaming, reformat on completion.

### - [ ] Reasoning effort — `reasoningEffort`

Per-chat `"low" | "medium" | "high" | "xhigh"` config. Quick questions do not need maximum reasoning. Expose via `/model` or a `/reasoning` command, persist alongside model overrides, pass to `buildSessionConfig()`. Not all models support it — check compatibility before applying.

### - [ ] Session disk cleanup — `deleteSession()`

`/new` currently calls `destroy()` which tears down the in-memory session but may leave artifacts on disk. Switch to `deleteSession()` in `src/commands/session.ts` and `src/agent.ts` for proper cleanup.

### - [ ] `onSessionStart` hook

SDK gives `source: "startup" | "resume" | "new"` context. Could replace some of the custom init logic in `getOrCreateSession()`. Extend `src/hooks/session-lifecycle.ts`.

### - [ ] `onUserPromptSubmitted` hook

Inject dynamic context (today's memory, channel state, anomalies) per-turn instead of baking everything into the system prompt at session creation. Keep static stuff (soul, human, preferences) in the system prompt, move the rest to this hook. Architectural shift — needs careful testing.

### - [ ] Graceful job cancellation

Jobs currently hard-timeout at 5 minutes then force-destroy the session. Call `abort()` first in `src/scheduler/job-runner.ts` for clean cancellation with partial results preserved. Optionally add `/job cancel <name>`.

---

## SDK — Later

Revisit as needs evolve or the SDK stabilizes.

- [ ] **BYOK / `ProviderConfig`** — Fall back to a self-hosted model when Copilot quota runs out. Needs quota detection.
- [ ] **Telemetry / `TelemetryConfig`** — OTLP export for observability beyond SQLite audit logs.
- [ ] **`cliUrl`** — Connect to a remote CLI server instead of managing the process locally.

---

## Custom Features

New capabilities not covered by the SDK.

### - [ ] Voice response (TTS)

Neo already transcribes incoming voice. Convert responses to audio and reply with `ctx.replyWithVoice()`. Use Deepgram TTS, ElevenLabs, or OpenAI TTS. Trigger when a voice message was received or via a toggle. Build on existing Deepgram STT integration in `bot.ts`.

### - [ ] Multi-user support

Extend beyond single `TELEGRAM_OWNER_ID`. Permission tiers: `owner` (full access), `trusted` (chat access with limited tools), `guest` (specific commands only). New `NEO_TRUSTED_USERS` config. Extend owner-only middleware in `bot.ts`, scope tool permissions per role in `pre-tool.ts`. Per-user session isolation or shared sessions depending on chat type.

### - [ ] Channel-aware routing

Different default models, reasoning effort, and personas per group chat. Extend `channel_config` table in `src/memory/db.ts` with `model` and `reasoning_effort` columns. Update `/channel` command. Wire into `getModelForChat()` and `buildSessionConfig()` in `agent.ts`.

### - [ ] Proactive notifications

Agent-initiated messages from context changes, repo events, or memory triggers — not just scheduled reminders and jobs. GitHub webhooks (CI failures, PR reviews), periodic context checks, memory-based triggers. Route to the correct chat, deduplicate, rate-limit. The scheduler loop already ticks every 30s and could evaluate triggers.

### - [ ] Multi-channel support

Neo is currently Telegram-only. The Copilot SDK session layer is transport-agnostic — `session.send()` does not depend on message origin. Add a transport abstraction so Neo can run on Discord, Slack, or other future channels without duplicating agent logic.

Rough shape: extract a `Transport` interface (send message, edit message, send photo, request user input, typing indicator) from the current Telegram-specific code in `src/bot.ts` and `src/telegram/`. Each channel gets its own transport implementation. The agent, hooks, memory, scheduler, and tools stay untouched — they talk to the transport, not Telegram directly.

Discord is the obvious first addition. Use `discord.js` for the bot, map slash commands to Discord application commands, handle message splitting for Discord's 2000-char limit (vs Telegram's 4096). Voice channels could also connect to the TTS feature.

Start by identifying every direct `ctx.reply` / `ctx.api` / grammY call and mapping them to transport interface methods.

### - [ ] Image generation

Generate images from text prompts and send as Telegram photos via `ctx.replyWithPhoto()`. Neo can browse and screenshot but cannot create visuals from scratch. New custom tool in `src/tools/` that takes a prompt, hits an image API, and returns binary data. Could also support image editing (inpainting, style transfer) later.

### - [ ] Knowledge base / RAG

Index documents, PDFs, and codebases into a vector store for retrieval-augmented generation. Neo's memory system handles personal context well but cannot answer questions over large external document sets. Could use SQLite with vector extensions (sqlite-vec) or a lightweight embedding store. New tool for indexing and querying, complementing the existing `memory` and `conversation` tools.

### - [ ] Approval workflows

Replace blanket `approveAll` with selective confirmation for dangerous operations. Safe tools (view, rg, glob, web_search) stay auto-approved. Dangerous ones (bash with `rm -rf`, force-push, `system.restart_service`) route through Telegram confirmation via the existing `ask_user` bridge. Configurable allowlist in the pre-tool hook — builds on `src/hooks/pre-tool.ts` and `src/telegram/user-input.ts`.

### - [ ] Smart model routing

Auto-select model based on task complexity instead of one static default. Quick factual questions get a fast cheap model, coding and reasoning tasks get the heavier one. Could use keyword heuristics, message length, or a lightweight classifier. Wire into `buildSessionConfig()` or `onUserPromptSubmitted`. An explicit model override always wins.

---

## Cleanup

- [ ] **`refreshSessionContext()`** — Destroys and recreates sessions to update the system prompt. `onUserPromptSubmitted` hook would avoid this churn.
- [ ] **`post-tool.ts`** — One log line for browser screenshots. Consolidate into audit logging or expand.
- [ ] **Model override persistence** — Separate `session-model-overrides.json` could move to the managed config system.
