# Neo

Personal AI agent powered by the GitHub Copilot SDK, accessible via Telegram.

For a maintainer-focused breakdown of built-in Copilot CLI / SDK capabilities versus Neo-specific customizations, see [`copilot-cli-sdk-reference.md`](./copilot-cli-sdk-reference.md).

## Setup

### Prerequisites

- Node.js v24.14.0
- GitHub account with Copilot access
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Your Telegram user ID (from [@userinfobot](https://t.me/userinfobot))
- Playwright Chromium browser (`npx playwright install --with-deps chromium`)

### Install

```bash
git clone https://github.com/saadjs/neo.git neo && cd neo
nvm use
npm install
cp .env.example .env
# Edit .env with your tokens
```

### Run (dev)

```bash
npm run dev
```

### Telegram group chats

If you want Neo to respond to regular messages in group chats without being tagged, disable the bot's privacy mode in [@BotFather](https://t.me/BotFather):

```text
/setprivacy
→ select @your_bot
→ Disable
```

If you changed this after the bot was already in the group, remove the bot from the group and add it back so Telegram refreshes permissions. Otherwise Neo may still ignore normal group messages because Telegram never delivers them.

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

Neo supports two Linux deployment modes:

- user service: runs under `~/.config/systemd/user` as the login user who installs it, similar to OpenClaw
- system service: runs under `/etc/systemd/system` as a dedicated `neo` user

Recommended first-time setup:

```bash
./deploy/setup-ubuntu.sh
```

The script prompts for `systemd scope (system/user)`:

- `user` is the default and installs a `systemd --user` unit at `~/.config/systemd/user`, defaults to `$HOME/neo`, and uses the current login user
- `system` keeps the existing production layout with `/opt/neo` and the `neo` user

For later updates, run the same command again from the server-side bootstrap checkout after pulling the latest commit:

```bash
git pull
./deploy/setup-ubuntu.sh
```

The script will prompt for the systemd scope, service name, install directory, and app user, then:

- install or update the pinned system Node runtime at `/usr/bin/node` when needed
- install the `systemd` unit
- clone or update the GitHub repo in the install directory
- optionally create and open `.env`
- run `npm ci` and `npm run build`
- install Playwright Ubuntu deps and Chromium
- run preflight checks
- optionally enable and start the service

Manual equivalent for a system service:

```bash
sudo ./deploy/install-systemd.sh

git clone --branch main git@github.com:saadjs/neo.git /opt/neo
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

Manual equivalent for a user service:

```bash
./deploy/install-systemd-user.sh neo "$HOME/neo" "$USER"

git clone --branch main git@github.com:saadjs/neo.git "$HOME/neo"
cd "$HOME/neo"

npm ci
npm run build
npx playwright install --with-deps chromium

# Create and edit $HOME/neo/.env first
./deploy/preflight.sh "$HOME/neo/.env"

sudo loginctl enable-linger "$USER"
systemctl --user start neo
journalctl --user -u neo -f  # view logs
```

Notes:

- The setup script bootstraps system Node at `/usr/bin/node` and currently targets `v24.14.0`.
- Neo restarts by exiting and letting `systemd` restart the service via `Restart=always`.
- When run directly outside `systemd`, Neo defaults to `$HOME/.neo` for data and `$HOME/.neo/logs` for logs.
- The system service template sets `NEO_DATA_DIR=/opt/neo/data` and `NEO_LOG_DIR=/opt/neo/logs`.
- The user service template sets `NEO_DATA_DIR=$HOME/.neo` and `NEO_LOG_DIR=$HOME/.neo/logs`.
- The deploy setup now syncs code from the checkout's Git `origin` and current branch instead of copying files with `rsync`.
- User-service installs must run as the same login user that will own the `systemd --user` unit.
- User services run with the same filesystem permissions as the installing login user, so they can access files in that user's home directory such as shell dotfiles when needed.
- `systemd` does not automatically source `.bashrc` or `.zshrc`; put required runtime settings in Neo's `.env` unless you explicitly load shell startup files yourself.
- `sudo loginctl enable-linger "$USER"` keeps a user service running after logout.
## Commands

| Command | Description |
|---------|-------------|
| `/start` | Show all commands |
| `/new` | Start a fresh conversation |
| `/model [name]` | Open model picker, or switch directly by name |
| `/sessions` | List active sessions |
| `/memory [query]` | View or search memory (`/memory #tag`, `/memory recent N`, or full-text search) |
| `/loglevel <level>` | Set log verbosity (error/warn/info/debug/trace) |
| `/soul` | Show current persona |
| `/status` | Show runtime status, default model, and current chat model |
| `/whichmodel` | Show default model and current chat model |
| `/usage` | Show remaining monthly GitHub Copilot usage |
| `/audit [week\|tool]` | Tool usage statistics |
| `/cost [week\|month]` | Token usage and estimated costs |
| `/channel [label\|topics] [value]` | Channel config (groups only) |
| `/restart` | Restart Neo |
| `/help` | Show all commands |

`/model` opens a clickable picker sourced from your Copilot account's available models (cached daily). `/model <name>` still sets a chat-specific model override directly. `/whichmodel` reports the default model and this chat's current active model. `/new` starts a fresh session but keeps that chat-specific override if one exists; otherwise it uses Neo's default model from the managed runtime config in `NEO_DATA_DIR` (default: `$HOME/.neo/config.json`).

## Tools

Neo registers these custom tools alongside the Copilot SDK's built-in capabilities (shell, filesystem, GitHub):

- **browser** — Automate websites with persistent Playwright sessions, screenshots, and stored credentials
- **memory** — Read/write/append/search memory files
- **reminder** — Create, list, and cancel scheduled reminders (once, daily, weekly, monthly, weekdays)
- **job** — Manage recurring AI jobs on cron schedules
- **conversation** — Search prior chats and retrieve recent history
- **system** — Inspect settings, apply safe config changes, restart

## Memory

- `$NEO_DATA_DIR/SOUL.md` — Neo's persona (editable by Neo)
- `$NEO_DATA_DIR/PREFERENCES.md` — Learned user preferences
- `$NEO_DATA_DIR/HUMAN.md` — Facts about the user
- `$NEO_DATA_DIR/memory/MEMORY-yyyy-mm-dd.md` — Daily memory logs
- `$NEO_DATA_DIR/memory/MEMORY-SUMMARY-yyyy-Wnn.md` — Weekly memory summaries

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

`TELEGRAM_OWNER_ID` keeps direct messages owner-only. Group chat visibility is controlled by Telegram privacy mode, not by `.env`.

Browser credentials format:

```json
{"github":{"username":"neo@example.com","password":"super-secret"}}
```

## Observability

- **Tool auditing** — every tool invocation is logged with timing and success/failure status
- **Cost tracking** — token usage per model with estimated costs
- **Anomaly detection** — 3+ consecutive tool failures trigger alerts in system context

## Autonomy

Mutable application settings live in `$NEO_DATA_DIR/config.json` (default: `$HOME/.neo/config.json`). Secrets stay in `.env`. Config changes and restart requests are recorded in `$NEO_DATA_DIR/config-history.jsonl` and `$NEO_DATA_DIR/restart-history.jsonl`.

Safe autonomous config updates are limited to:

- `COPILOT_MODEL` (Neo's default model, not chat-specific overrides)
- `NEO_LOG_LEVEL`
- `NEO_SKILL_DIRS`
- `NEO_CONTEXT_COMPACTION_ENABLED`
- `NEO_CONTEXT_COMPACTION_THRESHOLD`
- `NEO_CONTEXT_BUFFER_EXHAUSTION_THRESHOLD`

Other managed settings remain approval-required. When a change requires a restart, Neo writes a structured restart marker and exits so the service supervisor can restart it cleanly.
