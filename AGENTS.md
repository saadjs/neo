# Repository Guidelines

## What is Neo

Neo is a personal AI agent powered by the GitHub Copilot SDK (`@github/copilot-sdk`), accessible via Telegram. It wraps the Copilot CLI as a JSON-RPC server, creates sessions per Telegram chat, and extends the agent with custom tools, session hooks, memory, and scheduled jobs.

## Project Structure & Module Organization

`src/` contains the application entrypoint and all runtime code. Key areas are `src/commands/` for Telegram command handlers, `src/tools/` for custom agent tools (browser, memory, system, reminder, job, conversation), `src/hooks/` for session lifecycle hooks, `src/memory/` for persistence and tagging, `src/scheduler/` for recurring jobs, `src/telegram/` for Telegram-specific utilities (progress, user input, message splitting), and `src/logging/` for audit and cost tracking. Tests live beside implementation files as `src/**/*.test.ts`. Runtime data is stored under `data/`; deployment assets live in `deploy/`; production output is bundled to `dist/`.

## Build, Test, and Development Commands

Use Node `24.14.0` as declared in `package.json`.

- `npm run dev` runs the bot directly from `src/index.ts` with `tsx`.
- `npm run build` bundles the app with `esbuild` to `dist/index.js`.
- `npm run start` runs the built bundle.
- `npm run test` runs the Vitest suite once.
- `npm run test:watch` runs tests in watch mode.
- `npx vitest run src/path/to/file.test.ts` runs a single test file.
- `npx vitest run -t "test name pattern"` runs tests matching a name.
- `npm run typecheck` runs strict TypeScript checks without emitting files.
- `npm run lint` checks with `oxlint`; `npm run fmt` formats with `oxfmt`.
- `npm run check` runs lint, format check, typecheck, and tests together.

## Architecture

### Request Flow

Telegram message → `bot.ts` (grammY middleware) → `agent.ts` (getOrCreateSession) → `CopilotSession.send()` → session events → `bot.ts` (event handler, progress UI) → Telegram reply.

### Key Modules

- **bot.ts** — grammY bot with owner-only middleware. Handles text, photos, documents, voice. Manages typing indicators and live progress messages. Listens to session events for tool execution, compaction, and reasoning.
- **agent.ts** — Manages `CopilotClient` lifecycle and a `Map<chatId, CopilotSession>`. Sessions are created or resumed per chat. Builds session config with `systemMessage: { mode: "replace" }` (full prompt from memory files), `onPermissionRequest: approveAll`, custom tools, hooks, infinite sessions, and skill directories.
- **config.ts** — Env vars for secrets, managed config file (`data/config.json`) for runtime-tunable settings (model, log level, compaction thresholds, skill dirs).

### Copilot CLI Built-in Tools

The CLI provides these tools automatically — do NOT reimplement them: `bash`, `write_bash`, `read_bash`, `stop_bash`, `list_bash`, `apply_patch`, `view`, `rg`, `glob`, `web_search`, `web_fetch`, `store_memory`, `skill`, `sql`, `task`, `read_agent`, `list_agents`, `report_intent`, `github-mcp-server-*`, `multi_tool_use.parallel`.

### Custom Tools (src/tools/)

Defined with `defineTool()` from the SDK using Zod schemas. All registered in `src/tools/index.ts`. If a custom tool shares a name with a built-in, `overridesBuiltInTool: true` is required — avoid this unless intentionally replacing built-in behavior. Use `createAuditTimer()` from `src/logging/audit.ts` for execution timing.

### Session Hooks (src/hooks/)

Hooks intercept session lifecycle, defined per-chat via `buildSessionHooks(chatId)`. Hook types are re-derived from `SessionConfig["hooks"]` in `src/hooks/types.ts` since the SDK doesn't export them directly. Current hooks: `onPreToolUse` (blocks restart during jobs), `onPostToolUse`, `onErrorOccurred` (retry/abort logic), `onSessionEnd` (cleanup).

### Memory System (src/memory/)

System prompt assembled by `buildSystemContext(chatId)` from: `SOUL.md`, `HUMAN.md`, `PREFERENCES.md`, daily memory, weekly summaries, channel-scoped overlays, runtime context, and anomalies. Compaction summaries auto-saved and tagged. Weekly decay runs Sundays 3AM UTC.

## Coding Style & Naming Conventions

Strict TypeScript ESM with `rootDir` set to `src/`. Double quotes, semicolons, concise module-level functions. `camelCase` for variables/functions, `PascalCase` for types and classes, kebab-case filenames (e.g. `browser-runtime.ts`). Tests next to source. Run `npm run fmt` and `npm run lint:fix` before pushing.

## Testing Guidelines

Vitest is configured for the Node environment and only picks up `src/**/*.test.ts`. Add or update tests for every behavioral change, especially around command handlers, memory, scheduler logic, and tool integrations. No coverage threshold is enforced, so expect targeted regression tests instead. Prefer descriptive test names that state behavior, e.g. `it("persists restart history on success")`. Add regression tests when appropriate.

## Commit & Pull Request Guidelines

Conventional prefixes: `feat:`, `feat(scope):`, `fix:`, `chore:`, `refactor:`, `style:`, `test:`. Keep commits focused and imperative. Before opening a PR, run `npm run check`; Husky runs `check:staged` on commit and full `check` on push. PRs should summarize user-visible changes, call out config or data migrations, link related issues, and include screenshots or logs when UI, Telegram flows, or browser automation behavior changes.
