# Neo

Personal AI agent powered by the GitHub Copilot SDK, accessible via Telegram.

## Setup

### Prerequisites

- Node.js v24.14.0
- GitHub account with Copilot access
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Your Telegram user ID (from [@userinfobot](https://t.me/userinfobot))
- Playwright Chromium browser (`npx playwright install --with-deps chromium`)

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

This path assumes a direct Ubuntu host install under `/opt/neo` and a `systemd` service running as the `neo` user.

```bash
sudo ./deploy/install-systemd.sh

sudo rsync -a --delete ./ /opt/neo/
cd /opt/neo

npm ci
npm run build
npx playwright install --with-deps chromium

# Create and edit /opt/neo/.env first
sudo chown -R neo:neo /opt/neo
sudo -u neo ./deploy/preflight.sh

sudo systemctl start neo
sudo journalctl -u neo -f  # view logs
```

Notes:

- The service expects system Node at `/usr/bin/node` and currently targets `v24.14.0`.
- Neo restarts by exiting and letting `systemd` restart the service via `Restart=always`.
- Runtime state defaults to `/opt/neo/data` and `/opt/neo/logs` through the unit file.
- If you use the `google_workspace` tool, install the `gws` CLI or set `GOOGLE_WORKSPACE_CLI_PATH`.

## Commands

| Command | Description |
|---------|-------------|
| `/new` | Start a fresh conversation |
| `/model <name>` | Switch the model for the current chat only |
| `/sessions` | List active sessions |
| `/memory [query]` | View or search memory (supports `#tag` filter, `recent N`) |
| `/loglevel <level>` | Set log verbosity (error/warn/info/debug/trace) |
| `/soul` | Show current persona |
| `/status` | Show runtime status and restart state |
| `/audit [week\|tool]` | Tool usage statistics |
| `/cost [week\|month]` | Token usage and estimated costs |
| `/restart` | Restart Neo |
| `/help` | Show all commands |

`/model <name>` sets a chat-specific model override. `/new` starts a fresh session but keeps that chat-specific override if one exists; otherwise it uses Neo's default model from `data/config.json`.

## Tools

Neo registers these custom tools alongside the Copilot SDK's built-in capabilities (shell, filesystem, GitHub):

- **browser** — Automate websites with persistent Playwright sessions, screenshots, and stored credentials
- **web_search** — Search the web via DuckDuckGo
- **google_workspace** — Google Workspace CLI wrapper (Gmail, Calendar, Drive, Sheets)
- **memory** — Read/write/append/search memory files
- **reminder** — Create, list, and cancel scheduled reminders (once, daily, weekly, monthly, weekdays)
- **job** — Manage recurring AI jobs on cron schedules
- **conversation** — Search prior chats and retrieve recent history
- **system** — Inspect settings, apply safe config changes, restart

## Memory

- `data/SOUL.md` — Neo's persona (editable by Neo)
- `data/PREFERENCES.md` — Learned user preferences
- `data/HUMAN.md` — Facts about the user
- `data/memory/MEMORY-yyyy-mm-dd.md` — Daily memory logs
- `data/memory/MEMORY-SUMMARY-yyyy-Wnn.md` — Weekly memory summaries

Neo auto-compacts long conversations before they fall out of context. Session summaries are stored in the daily memory file and auto-tagged with topics. A weekly decay job (Sundays 3 AM UTC) compacts old daily entries into weekly summaries. All memory content is indexed for full-text search.

## Voice Messages

Send a voice message in Telegram and Neo will transcribe it via Deepgram and respond. Requires `DEEPGRAM_API_KEY` in `.env`.

## Environment Variables

See [`.env.example`](.env.example) for all options.

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | From @BotFather |
| `TELEGRAM_OWNER_ID` | Yes | Your Telegram user ID |
| `GITHUB_TOKEN` | Yes | GitHub PAT with Copilot access |
| `DEEPGRAM_API_KEY` | No | Enable voice transcription |
| `NEO_BROWSER_HEADLESS` | No | Browser mode (default: `true`) |
| `NEO_BROWSER_LAUNCH_ARGS` | No | Extra Chromium flags |
| `NEO_BROWSER_CREDENTIALS_JSON` | No | Stored login credentials (JSON) |
| `NEO_DATA_DIR` | No | Override runtime data dir |
| `NEO_LOG_DIR` | No | Override runtime log dir |
| `NEO_SYSTEMD_UNIT` | No | Service unit name exposed to status/restart logic |
| `NEO_SYSTEMCTL_SCOPE` | No | `system` or `user` for status checks |
| `GOOGLE_WORKSPACE_CLI_PATH` | No | Path to the `gws` CLI used by the Google Workspace tool |

Browser credentials format:

```json
{"github":{"username":"neo@example.com","password":"super-secret"}}
```

## Observability

- **Tool auditing** — every tool invocation is logged with timing and success/failure status
- **Cost tracking** — token usage per model with estimated costs
- **Anomaly detection** — 3+ consecutive tool failures trigger alerts in system context

## Autonomy

Mutable application settings live in `data/config.json`. Secrets stay in `.env`. Config changes and restart requests are recorded in `data/config-history.jsonl` and `data/restart-history.jsonl`.

Safe autonomous config updates are limited to:

- `COPILOT_MODEL` (Neo's default model, not chat-specific overrides)
- `NEO_LOG_LEVEL`
- `NEO_SKILL_DIRS`
- `NEO_CONTEXT_COMPACTION_ENABLED`
- `NEO_CONTEXT_COMPACTION_THRESHOLD`
- `NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD`

Other managed settings remain approval-required. When a change requires a restart, Neo writes a structured restart marker and exits so the service supervisor can restart it cleanly.
