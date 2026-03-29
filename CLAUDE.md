# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Neo

Neo is a personal AI agent powered by the GitHub Copilot SDK (`@github/copilot-sdk`), accessible via Telegram. It wraps the Copilot CLI as a JSON-RPC server, creates sessions per Telegram chat, and extends the agent with custom tools, session hooks, memory, and scheduled jobs.

## Project Structure & Module Organization

`src/` contains the application entrypoint and all runtime code. Key areas are `src/commands/` for Telegram command handlers, `src/tools/` for custom agent tools (browser, memory, system, reminder, job, conversation), `src/hooks/` for session lifecycle hooks, `src/memory/` for persistence and tagging, `src/scheduler/` for recurring jobs, `src/telegram/` for Telegram-specific utilities (progress, user input, message splitting), and `src/logging/` for audit and cost tracking. Tests live beside implementation files as `src/**/*.test.ts`. Runtime data is stored under `NEO_DATA_DIR` (default: `~/.neo`); deployment assets live in `deploy/`; production output is bundled to `dist/`.

## Commands

```bash
npm run dev          # Run from source with tsx
npm run build        # Bundle with esbuild to dist/index.js
npm run start        # Run production bundle
npm run test         # Vitest suite (once)
npm run test:watch   # Vitest in watch mode
npm run typecheck    # tsc --noEmit
npm run lint         # oxlint
npm run fmt          # oxfmt --write
npm run check        # lint + fmt:check + typecheck + test (runs on git push via Husky)
```

Run a single test file: `npx vitest run src/tools/browser.test.ts`
Run tests matching a name: `npx vitest run -t "persists restart history"`

## Architecture

### Request Flow

```
Telegram message → bot.ts (grammY middleware) → agent.ts (getOrCreateSession) → CopilotSession.send()
                                                                                      ↓
                                              bot.ts (event handler, progress UI) ← session events
                                                      ↓
                                              Telegram reply (chunked markdown)
```

1. **bot.ts** — grammY bot. Owner-only middleware. Handles text, photos, documents, voice. Manages typing indicators and a live progress message (thinking → reasoning → tool → done). Listens to session events for tool execution, compaction, and reasoning.
2. **agent.ts** — Manages `CopilotClient` lifecycle and a `Map<chatId, CopilotSession>`. Sessions are created or resumed per chat. Handles model overrides (per-chat and default), stale session cleanup, and turn tracking. Builds session config via `buildSessionConfig()`.
3. **config.ts** — All configuration. Env vars for secrets, a managed config file under `NEO_DATA_DIR` (default: `~/.neo/config.json`) for runtime-tunable settings (model, log level, compaction thresholds, skill dirs). Managed config supports backups, validation, and safe restoration.

### Copilot SDK Integration (agent.ts → buildSessionConfig)

Sessions are created with:

- **`systemMessage: { mode: "replace" }`** — Full system prompt replacement assembled from memory files (soul, human, preferences, daily memory, weekly summaries, channel config). This means Neo does NOT use the default CLI persona.
- **`tools: allTools`** — Custom tools registered alongside CLI built-ins (see below).
- **`onPermissionRequest: approveAll`** — All tool executions auto-approved.
- **`onUserInputRequest`** — Wired to Telegram: when the agent calls `ask_user`, Neo sends the question to Telegram and waits for a reply.
- **`hooks: buildSessionHooks(chatId)`** — Pre/post tool use, error handling, session end.
- **`infiniteSessions`** — Enabled with configurable compaction thresholds.
- **`skillDirectories`** — Skills loaded from `./skills/` and `~/.agents/skills/`.
- **`workingDirectory`** — Set to project root so CLI file/shell tools operate on the server.

### Copilot CLI Built-in Tools

The CLI provides these tools automatically — do NOT reimplement them:

`bash`, `write_bash`, `read_bash`, `stop_bash`, `list_bash`, `edit_file`, `read_file`, `apply_patch`, `view`, `rg`, `glob`, `web_search`, `web_fetch`, `store_memory`, `skill`, `sql`, `task`, `read_agent`, `list_agents`, `report_intent`, `github-mcp-server-*` (issues, PRs, commits, code search, etc.), `multi_tool_use.parallel`

### Custom Tools (src/tools/)

Custom tools are defined with `defineTool()` from the SDK using Zod schemas. All tools are registered in `src/tools/index.ts` and passed to session config.

Current custom tools: `browser`, `memory`, `system`, `reminder`, `job`, `conversation`.

**Adding a new tool:**

```typescript
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";

export const myTool = defineTool("my_tool", {
  description: "What this tool does",
  parameters: z.object({
    param: z.string().describe("Description"),
  }),
  handler: async (args, invocation) => {
    // invocation.sessionId is available for audit logging
    return "result string or JSON-serializable object";
  },
});
```

Then add it to `allTools` in `src/tools/index.ts`.

**Key rules for custom tools:**

- If you name a tool the same as a built-in, you must set `overridesBuiltInTool: true` — otherwise the SDK throws. Avoid this unless intentionally replacing built-in behavior.
- Handler return: string or JSON-serializable object. For binary data (images), return `{ type: "binary", data: Buffer }`.
- Use `createAuditTimer(invocation.sessionId, toolName, args)` from `src/logging/audit.ts` for execution timing.
- Redact sensitive params (passwords, keys) in audit logs.

### Session Hooks (src/hooks/)

Hooks intercept session lifecycle. Defined per-chat via `buildSessionHooks(chatId)`.

- **onPreToolUse** — Can return `{ permissionDecision: "allow"|"deny"|"ask", modifiedArgs, additionalContext }`. Currently blocks `system.restart_service` when a job is running.
- **onPostToolUse** — Can return `{ additionalContext }` to inject context after tool results.
- **onErrorOccurred** — Can return `{ errorHandling: "retry"|"skip"|"abort", retryCount, userNotification }`. Retries recoverable model_call errors, aborts with notification on non-recoverable ones.
- **onSessionEnd** — Cleanup (cancels pending user input).

Hook types are re-derived from `SessionConfig["hooks"]` in `src/hooks/types.ts` since the SDK doesn't export them directly.

### Memory System (src/memory/)

System prompt is built by `buildSystemContext(chatId)` which assembles:

- `$NEO_DATA_DIR/SOUL.md` — Persona (editable by Neo)
- `$NEO_DATA_DIR/HUMAN.md` — Facts about the user
- `$NEO_DATA_DIR/PREFERENCES.md` — User preferences
- `$NEO_DATA_DIR/memory/MEMORY-yyyy-mm-dd.md` — Daily logs
- Weekly summaries from memory decay (`decay.ts`)
- Channel-scoped overlays (soul, preferences, topics, memory)
- Runtime context and anomalies

Compaction summaries are auto-saved to daily memory and tagged with topics (`tagging.ts`). Weekly decay runs Sundays 3AM UTC.

### Scheduler (src/scheduler/)

`job-runner.ts` executes cron-based jobs. Jobs run AI prompts on schedule and send output to the owner. The pre-tool hook checks `isJobRunning()` to prevent restarts during job execution.

### Telegram Layer (src/telegram/, src/commands/)

- `src/commands/` — Slash command handlers registered via grammY
- `src/telegram/progress.ts` — Progress message formatting (phases: thinking, reasoning, tool, skill, compacting, waiting)
- `src/telegram/user-input.ts` — Bridges SDK's `ask_user` tool to Telegram (pending input per chat, watchers, cancellation)
- `src/telegram/messages.ts` — Message splitting for Telegram's 4096-char limit
- `src/telegram/files.ts` — Download Telegram files to local temp paths
- `src/telegram/session-errors.ts` — Determines which session errors to silence vs surface

## Testing

Vitest, Node environment, picks up `src/**/*.test.ts`. Add or update tests for every behavioral change. Add regression tests when appropriate. Prefer descriptive test names that state behavior, e.g. `it("persists restart history on success")`.

## Style

Strict TypeScript ESM. Double quotes, semicolons. `camelCase` for variables/functions, `PascalCase` for types. Kebab-case filenames. Tests next to source as `*.test.ts`.

## Documentation

- After adding new Telegram slash (`/`) commands, or features, make sure to update the @README.md or other documentation files as needed.
- Keep slash commands in alphabetical order in `src/commands/definitions.ts` (the `commandDefinitions` array) and `src/commands/index.ts` (the `commandHandlers` object).

## Git Commit Guidelines

- Use Atomic commits formats
- Use Conventional Commit prefixes (`feat:`, `fix:`, `chore:`, etc.)

## PRs

Summarize user-visible changes, call out config or data migrations, link related issues, and include screenshots or logs when UI, Telegram flows, or browser automation behavior changes.
