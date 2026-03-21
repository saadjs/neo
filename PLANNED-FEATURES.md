# Planned Features

Planned work for Neo: SDK capabilities available for integration, plus custom features not provided out of the box.

See [`copilot-cli-sdk-reference.md`](./copilot-cli-sdk-reference.md) for build-vs-configure decisions.

> The Copilot SDK is in **Technical Preview** — re-validate against the latest release before implementing SDK items.

---

## Wire from the SDK

SDK capabilities already available for Telegram integration.

### - [x] `/cancel` — `session.abort()`

Implemented. `/cancel` calls `abort()` on the active session to stop the in-flight turn without destroying the session. Partial responses are suppressed via an abort flag consumed by `handleMessage` in `bot.ts`. Handles no-session and no-active-turn cases gracefully.

### - [x] Streaming responses

Implemented. `streaming: true` is set in `buildSessionConfig()` in `agent.ts`. `bot.ts` subscribes to `assistant.message_delta` events, buffers deltas in a `streamBuffer`, and periodically edits the Telegram progress message with partial content. Edits are debounced at 1.5s to stay within Telegram rate limits. Raw text is shown during streaming (no `parse_mode`) to avoid broken partial markdown; the final formatted response with markdown is sent on completion. Long streaming content is truncated to show the tail (last 4000 chars) while streaming.

### - [x] Reasoning effort — `reasoningEffort`

Implemented. `/reasoning` command exposes per-chat reasoning effort configuration. Shows an inline keyboard picker with supported levels for the current model, or accepts `/reasoning <level>` for direct switching and `/reasoning reset` to clear. Persisted to `session-reasoning-overrides.json` alongside model overrides. Passed to `buildSessionConfig()` as `reasoningEffort`. Models that don't support reasoning effort show an unsupported message. Switching to an incompatible model automatically clears the reasoning effort override. `/whichmodel` displays the active reasoning effort. Since the SDK has no `setReasoningEffort()` method, changes trigger a session refresh via `refreshSessionContext()`.

### - [x] Session disk cleanup — `deleteSession()`

Implemented. Session deletion is now explicit instead of coupled to every reset. `/new` and default `destroySession()` behavior disconnect the active in-memory session and clear the active pointer, but keep the persisted session on disk so it remains resumable from `/sessions`. Explicit delete flows call `client.deleteSession(sessionId)`: the `/sessions` picker includes per-session ✕ delete buttons and a "Delete All" option, deleting the active session tears it down first, and stale-session cleanup paths (`refreshSessionContext`, `endSessionTurn`, `stopAgent`) still remove superseded session artifacts from disk.

### - [x] `onSessionStart` hook

Implemented. `sessionStart(chatId, getModel)` factory in `src/hooks/session-start.ts` handles two concerns: (1) session bookkeeping — `setActiveSession` on every start/resume, `logSession` for new sessions only — migrated from scattered calls in `agent.ts`; (2) dynamic context injection via `additionalContext` — today's memory, channel memory, runtime state, and anomaly alerts are now injected at session start instead of baked into the static system prompt. Static content (persona, preferences, human facts, weekly summaries) remains in `buildSystemContext()`.

### - [x] Graceful job cancellation

Implemented. Removed the 5-minute hard timeout — jobs now run to completion, letting the model decide when it's done. Added explicit cancellation via `cancelRunningJob()` which calls `session.abort()` for graceful shutdown. The `job` tool exposes a `cancel` action (no parameters needed — only one job runs at a time). Partial results from `responseBuffer` are preserved on cancellation and sent to the owner. `getRunningJob()` exposes metadata about the currently executing job.

---

## SDK — Later

Revisit as needs evolve or the SDK stabilizes.

- [ ] **`onUserPromptSubmitted`** — Per-turn dynamic context injection. Deferred because `onSessionStart` already covers the primary use case: daily memory is too expensive for per-turn injection (and the model can use the `memory` tool for live reads), while runtime state and anomalies rarely change mid-session. Revisit when a concrete per-turn need arises (smart model routing, multi-user permission context, prompt augmentation).
- [x] **BYOK / `ProviderConfig`** — Multi-provider model access. Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` to enable additional providers. Models appear in the `/model` picker with provider tags (e.g., `[anthropic]`, `[copilot]`). Custom OpenAI-compatible endpoints (Ollama, etc.) supported via `NEO_PROVIDER_*` env vars. Provider changes trigger session refresh. Auto-fallback on quota exhaustion is out of scope for now.
- [ ] **Telemetry / `TelemetryConfig`** — OTLP export for observability beyond SQLite audit logs.
- [ ] **`cliUrl`** — Connect to a remote CLI server instead of managing the process locally.

---

## Custom Features

New capabilities not covered by the SDK.

### - [ ] Voice response (TTS)

Neo already transcribes incoming voice. Convert responses to audio and reply with `ctx.replyWithVoice()`. Use Deepgram TTS, ElevenLabs, or OpenAI TTS. Trigger when a voice message was received or via a toggle. Build on existing Deepgram STT integration in `bot.ts`.

### - [ ] Multi-user support

Extend beyond single `TELEGRAM_OWNER_ID`. Permission tiers: `owner` (full access), `trusted` (chat access with limited tools), `guest` (specific commands only). New `NEO_TRUSTED_USERS` config. Extend owner-only middleware in `bot.ts`, scope tool permissions per role in `pre-tool.ts`. Per-user session isolation or shared sessions depending on chat type.

### - [x] Channel-aware routing

Implemented. Different default models, reasoning effort, and personas per group chat. The `channel_config` table includes `default_model` and `default_reasoning_effort` columns (added via migration). `getModelForChat()` and `getReasoningEffortForChat()` in `agent.ts` implement a three-tier resolution: per-chat override → channel default → global default. `buildSessionConfig()` passes both into the SDK. The `/channel` command supports subcommands: `label`, `topics`, `model` (with inline keyboard picker), `reasoning` (with inline keyboard picker), `soul` (persona overlay), and `preferences`. Channel-scoped soul overlays, preferences, topics, weekly summaries, and daily memory are all injected into the system context by `buildSystemContext()` and session start hooks.

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

- [ ] **`refreshSessionContext()`** — Destroys and recreates sessions to update the system prompt. Dynamic context (daily memory, anomalies, runtime state) is now injected via `onSessionStart`, but `refreshSessionContext` is still needed for reasoning effort changes because `reasoningEffort` is a session-level config parameter — no hook's `additionalContext` can change it.
- [ ] **`post-tool.ts`** — One log line for browser screenshots. Consolidate into audit logging or expand.
- [ ] **Model override persistence** — Separate `session-model-overrides.json` and `session-reasoning-overrides.json` could move to a DB table for consistency with channel-level config stored in `channel_config`. Currently per-chat overrides use JSON files while channel defaults use SQLite.
