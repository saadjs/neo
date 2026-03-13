# Neo

Personal AI agent powered by the GitHub Copilot SDK, accessible via Telegram.

## Setup

### Prerequisites

- Node.js ≥ 20
- GitHub account with Copilot access
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Your Telegram user ID (from [@userinfobot](https://t.me/userinfobot))

### Install

```bash
git clone <repo-url> neo && cd neo
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

### Deploy with systemd

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
| `/model <name>` | Switch LLM model |
| `/sessions` | List active sessions |
| `/memory [query]` | View or search memory |
| `/loglevel <level>` | Set log verbosity (error/warn/info/debug/trace) |
| `/soul` | Show current persona |
| `/restart` | Restart Neo |
| `/help` | Show all commands |

## Tools

Neo has 7 tools available to the agent:

- **run_shell** — Execute shell commands
- **web_search** — Search the web via DuckDuckGo
- **github** — GitHub operations via `gh` CLI
- **google_workspace** — Google Workspace CLI wrapper
- **memory** — Read/write/search memory files
- **filesystem** — Full filesystem access
- **system** — System info, restart, log level

## Memory

- `data/SOUL.md` — Neo's persona (editable by Neo)
- `data/PREFERENCES.md` — Learned user preferences
- `data/memory/MEMORY-yyyy-mm-dd.md` — Daily memory logs

## Environment Variables

See [`.env.example`](.env.example) for all options.
