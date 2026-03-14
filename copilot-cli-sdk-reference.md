# Copilot CLI / SDK Reference for Neo

This file is a maintainer reference for deciding whether a capability should be implemented in Neo or simply configured/enabled from GitHub Copilot CLI and the Copilot SDK.

The goal is simple: **do not rebuild features that Copilot CLI or the SDK already provide out of the box.** Add custom Neo code only when we need Telegram-specific behavior, project-specific state, or genuinely new capabilities.

## Upstream references

- [GitHub Copilot CLI README](https://raw.githubusercontent.com/github/copilot-cli/refs/heads/main/README.md)
- [GitHub Copilot SDK README](https://raw.githubusercontent.com/github/copilot-sdk/refs/heads/main/README.md)
- [GitHub Copilot SDK for Node.js/TypeScript README](https://raw.githubusercontent.com/github/copilot-sdk/refs/heads/main/nodejs/README.md)
- [Copilot SDK Cookbook (Node.js)](https://github.com/github/awesome-copilot/blob/main/cookbook/copilot-sdk/nodejs/README.md)
- [Copilot SDK custom instructions for Node.js](https://github.com/github/awesome-copilot/blob/main/instructions/copilot-sdk-nodejs.instructions.md)

> **Note:** The Copilot SDK is currently in **Technical Preview** and may change in breaking ways.

## What Copilot CLI already provides

From the upstream Copilot CLI README, the CLI already gives us:

- A terminal-native coding agent that can build, edit, debug, refactor, and understand code through natural-language conversations.
- GitHub integration out of the box.
- MCP-powered extensibility, including GitHub's MCP server by default and support for custom MCP servers.
- An approval-first interactive UX by default: in the normal CLI experience, actions are previewed and require explicit approval.
- Slash-command-driven features such as login, model switching, experimental mode, LSP status, and feedback submission.
- Experimental mode, including **Autopilot mode**.
- Model selection defaulting to Claude Sonnet 4.5, with alternatives like Claude Sonnet 4 and GPT-5.
- LSP integration when language servers are installed and configured (`~/.copilot/lsp-config.json` for user-level, `.github/lsp.json` for repo-level).

## What the Copilot SDK already provides

From the upstream SDK READMEs, the SDK already gives us:

- A programmatic client (`CopilotClient`) for driving Copilot CLI over JSON-RPC, with `clientName` identification.
- Automatic CLI lifecycle management, or connection to an already-running CLI server via `cliUrl`.
- Multi-session support: `createSession`, `resumeSession`, `listSessions` (with working-directory and git context filtering), `deleteSession`, `disconnect`, and `abort`.
- Client-level session lifecycle events: `session.created`, `session.deleted`, `session.updated`.
- Async message dispatch via `send()`, or synchronous send-until-idle via `sendAndWait()`.
- In-flight message cancellation via `abort()`.
- Explicit streaming mode (`streaming: true`) with `assistant.message_delta` and `assistant.reasoning_delta` events.
- File and image attachments.
- `reasoningEffort` session config (`"low"` | `"medium"` | `"high"` | `"xhigh"`) for models that support it.
- System prompt customization, including full prompt replacement via `systemMessage: { mode: "replace" }`.
- Infinite sessions with persisted workspace state and automatic context compaction.
- Automatic session cleanup via `Symbol.asyncDispose` (`await using`).
- Custom tools defined in application code with `defineTool()` and Zod schemas.
- Session hooks: `onPreToolUse`, `onPostToolUse`, `onUserPromptSubmitted`, `onSessionStart`, `onSessionEnd`, `onErrorOccurred`.
- User-input requests via the `ask_user` tool when the app supplies an `onUserInputRequest` handler.
- Skill directories.
- BYOK/custom providers via `ProviderConfig` — supports OpenAI, Azure, Anthropic, and local providers like Ollama.
- Multiple authentication paths: logged-in user, GitHub tokens, OAuth GitHub App tokens, and BYOK.
- Telemetry via `TelemetryConfig` — OTLP endpoint export, file-based export, content capture, and trace context propagation.

## Built-in tools we should treat as already available

Neo should assume the following capabilities already exist in the Copilot CLI runtime and should **not** be reimplemented as Neo custom tools:

### Shell and process tools

- `bash`
- `write_bash`
- `read_bash`
- `stop_bash`
- `list_bash`

### Filesystem and code editing tools

- `view`
- `rg`
- `glob`
- `apply_patch`

### Web and research tools

- `web_search`
- `web_fetch`

### Agent workflow and orchestration tools

- `task`
- `read_agent`
- `list_agents`
- `report_intent`
- `skill`
- `multi_tool_use.parallel`

### Memory and structured workflow helpers

- `store_memory`
- `sql`

### GitHub-native tools

GitHub repository and collaboration operations already come from built-in GitHub MCP tools, including:

- issues
- pull requests
- commits
- branches
- code search
- repository file contents
- workflow / GitHub Actions data
- Copilot Spaces

In this environment these are exposed through `github-mcp-server-*` tool namespaces.

### Conditional built-in tools

- `ask_user` is available when the SDK app provides `onUserInputRequest`.
- Neo **does** provide that handler, so user-interactive clarification is already supported through Telegram and should not be reinvented as a separate custom tool.

## Permission model: CLI default vs SDK default vs Neo

This is one of the most important distinctions.

### Plain Copilot CLI default

The upstream Copilot CLI README describes the CLI as approval-first: actions are previewed and require explicit user approval in the interactive terminal experience.

### SDK default

The upstream SDK README states that the SDK operates Copilot CLI in the equivalent of `--allow-all` by default for first-party tools, unless tool availability and permissions are customized.

### Neo's actual behavior

Neo explicitly configures:

```ts
onPermissionRequest: approveAll
```

in `src/agent.ts`, so Neo is intentionally **auto-approving tool executions** instead of relying on interactive terminal confirmation.

That means:

- Neo is closer to an embedded autonomous agent than a manually-approved CLI session.
- Permission policy changes should usually be implemented through SDK hooks and tool configuration, not by recreating approval UX from scratch.
- If we need finer control, the right place is `onPreToolUse`, `onPostToolUse`, or custom tool definitions, not duplicate tool wrappers.

### Custom-tool permission controls already supported by the SDK

The SDK already supports:

- `overridesBuiltInTool: true` for intentional replacement of a built-in tool.
- `skipPermission: true` for custom tools that should execute without a permission prompt.
- Hook-driven decisions of `"allow"`, `"deny"`, or `"ask"` in `onPreToolUse`.

## Neo's current SDK integration

Neo already wires a substantial amount of SDK functionality in `src/agent.ts`:

- `clientName: "neo"`
- `systemMessage: { mode: "replace", content: systemContext }`
- `tools: allTools`
- `skillDirectories: config.copilot.skillDirectories`
- `onPermissionRequest: approveAll`
- `onUserInputRequest: ...requestUserInput(...)`
- `hooks: buildSessionHooks(chatId)`
- `workingDirectory: config.paths.root`
- `infiniteSessions: { ... }`

This means Neo is already using the SDK for:

- client identification
- full system-prompt replacement
- custom tools
- skills
- automatic tool approval
- ask-user interactions
- session hooks (`onPreToolUse`, `onPostToolUse`, `onErrorOccurred`, `onSessionEnd`)
- repo-root tool execution
- infinite session compaction

## SDK features Neo could leverage via Telegram

These are SDK capabilities Neo does not yet use but could wire into the Telegram experience instead of building custom:

| SDK Feature | Telegram Integration Opportunity |
|---|---|
| `reasoningEffort` | Expose via `/model` command or per-chat config — let users pick reasoning depth per conversation |
| `abort()` | Wire to a `/cancel` Telegram command to stop an in-progress agent turn |
| `onUserPromptSubmitted` | Use for prompt augmentation (inject channel context, memory hints) instead of building it into system prompt assembly |
| `onSessionStart` | Replace or complement custom session init logic in `agent.ts` with this hook |
| `streaming` config flag | Explicitly enable for faster Telegram progress message updates |
| `deleteSession()` | Wire to `/new` or a `/delete` command for explicit session cleanup from disk |
| BYOK / `provider` config | Fall back to a self-hosted model when Copilot quota is exhausted |
| Telemetry / `TelemetryConfig` | Export traces to an OTLP collector for observability beyond Neo's custom audit logging |

## What is custom in Neo

Only these areas should be thought of as Neo-specific capabilities, because they are not covered by the default CLI/SDK stack:

- `browser`
- `memory`
- `system`
- `reminder`
- `job`
- `conversation`

These are registered in `src/tools/index.ts`.

Neo also adds custom runtime behavior around:

- Telegram transport and UX
- memory-file assembly for the system prompt
- session lifecycle hooks
- scheduler/job execution
- config persistence and restart logic
- audit and cost tracking

## Features we should prefer configuring instead of rebuilding

Before adding a new feature, check this list first.

### Do not add a custom Neo tool if the need is:

- shell execution
- reading or editing files
- searching code or files
- web lookup or page fetch
- GitHub repo / PR / issue / Actions access
- batching work across tools
- delegating work to sub-agents
- persistent session compaction
- asking the user a question
- model switching
- reasoning effort configuration
- message cancellation/abort
- LSP-backed code intelligence
- connecting to external model providers via BYOK
- telemetry/export of traces

### Prefer SDK/CLI configuration if the need is:

- changing the approval policy
- modifying prompts or persona
- intercepting tool calls, results, or user prompts (`onPreToolUse`, `onPostToolUse`, `onUserPromptSubmitted`)
- adding session-start or session-end logic (`onSessionStart`, `onSessionEnd`)
- enabling or disabling tools
- adding skills or skill directories
- wiring user input requests
- attaching files/images to prompts
- streaming mode configuration
- connecting to an external CLI server
- BYOK / custom provider setup
- OpenTelemetry trace export

### Add custom Neo code only when the need is:

- Telegram-specific UX or transport behavior
- repository-specific business logic
- memory persistence beyond built-in session state
- scheduling/reminders/jobs
- browser automation conventions specific to Neo
- project-specific safety or audit requirements that hooks alone do not cover

## Practical rule of thumb

When in doubt:

1. Check whether the capability is already a built-in CLI tool.
2. Check whether the SDK already exposes it as session config, hooks, tools, skills, user input, provider config, or telemetry.
3. Only then consider adding a Neo custom tool or subsystem.

If the feature is "general agent runtime behavior," it is probably already a Copilot CLI / SDK feature.

If the feature is "Neo-specific product behavior," it probably belongs in Neo.

## Sources used for this reference

Upstream:

- Copilot CLI README: <https://raw.githubusercontent.com/github/copilot-cli/refs/heads/main/README.md>
- Copilot SDK README: <https://raw.githubusercontent.com/github/copilot-sdk/refs/heads/main/README.md>
- Copilot SDK Node.js README: <https://raw.githubusercontent.com/github/copilot-sdk/refs/heads/main/nodejs/README.md>
- Copilot SDK Cookbook: <https://github.com/github/awesome-copilot/blob/main/cookbook/copilot-sdk/nodejs/README.md>
- Awesome Copilot collection: <https://github.com/github/awesome-copilot/blob/main/collections/copilot-sdk.md>

Local Neo integration:

- `src/agent.ts`
- `src/tools/index.ts`
- `src/hooks/types.ts`
- `README.md`
- `AGENTS.md`
