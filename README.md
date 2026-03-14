# Neo

Personal AI agent powered by the GitHub Copilot SDK, accessible via Telegram.

## Setup

### Prerequisites

- Node.js v24.14.0
- GitHub account with Copilot access
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Your Telegram user ID (from [@userinfobot](https://t.me/userinfobot))

### Install

```bash
git clone <repo-url> neo && cd neo
nvm use
npm install
cp .env.example .env
# Edit .env with your tokens
```

### Run (dev)

```bash
npm run dev
```

### Build & Run (production)

```bash
npm run build
node dist/index.js
```

### Deploy with Docker

```bash
cp .env.example .env
# Edit .env with your secrets
docker compose up -d
docker compose logs -f  # view logs
```

### Deploy with systemd

Install Node.js `v24.14.0` on the host first, or use the Docker deployment instead.

```bash
sudo cp deploy/neo.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now neo
sudo journalctl -u neo -f  # view logs
```

## Commands

| Command | Description |
|---------|-------------|
| `/new` | Start a fresh conversation |
| `/model <name>` | Switch the model for the current chat only |
| `/sessions` | List active sessions |
| `/memory [query]` | View or search memory |
| `/loglevel <level>` | Set log verbosity (error/warn/info/debug/trace) |
| `/soul` | Show current persona |
| `/status` | Show runtime status and restart state |
| `/restart` | Restart Neo |
| `/help` | Show all commands |

`/model <name>` sets a chat-specific model override. `/new` starts a fresh session but keeps that chat-specific override if one exists; otherwise it uses Neo's default model from `data/config.json`.

## Tools

Neo has 6 tools available to the agent:

- **run_shell** — Execute shell commands
- **web_search** — Search the web via DuckDuckGo
- **google_workspace** — Google Workspace CLI wrapper
- **memory** — Read/write/search memory files
- **filesystem** — Full filesystem access
- **system** — Explain status, inspect settings, apply safe config changes, restart

GitHub operations are handled natively by the Copilot SDK agent runtime.

## Memory

- `data/SOUL.md` — Neo's persona (editable by Neo)
- `data/PREFERENCES.md` — Learned user preferences
- `data/memory/MEMORY-yyyy-mm-dd.md` — Daily memory logs

Neo also auto-compacts long conversations before they fall out of context. When the Copilot session reaches the configured context threshold, the SDK creates a session summary in the background, Neo stores that summary in the current daily memory file, and the session can be resumed after a bot restart.

## Environment Variables

See [`.env.example`](.env.example) for all options.

## Autonomy

Neo now maintains a managed runtime state snapshot in `data/runtime-state.json`, records config changes in `data/config-history.jsonl`, and records restart requests/results in `data/restart-history.jsonl`.

Mutable application settings live in `data/config.json`. Secrets stay in `.env`.

Safe autonomous config updates are limited to:

- `COPILOT_MODEL` (Neo's default model, not chat-specific overrides)
- `NEO_LOG_LEVEL`
- `NEO_SKILL_DIRS`
- `NEO_CONTEXT_COMPACTION_ENABLED`
- `NEO_CONTEXT_COMPACTION_THRESHOLD`
- `NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD`

Other managed settings remain approval-required. When a change requires a restart, Neo writes a structured restart marker and attempts `systemctl restart <unit>`, falling back to exiting for supervisor restart if `systemctl` is unavailable or denied.
