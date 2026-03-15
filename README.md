# aido

Local API key rotation proxy for LLM providers.  
Automatically rotates keys on rate limits (429). Cooldowns tracked in SQLite.

---

## Requirements

- **Node.js v22+** — check with `node --version`
- **npm**

> Node.js v22 has SQLite built-in — no native compilation needed.

---

## Installation

### Step 1 — Clone and install dependencies

```bash
git clone git@github.com:Aldo-f/aido.git
cd aido
npm install
```

### Step 2 — Make the `aido` command available

**Option A: system-wide** (requires sudo)
```bash
npm run install:global
```

**Option B: current user only** (no sudo needed, recommended)
```bash
npm run install:local
```

Then make sure `~/.local/bin` is in your PATH.

**Bash / Zsh:**
```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

**Fish:**
```fish
fish_add_path ~/.local/bin
```

**Option C: with auto-start on boot** (Linux with systemd)
```bash
npm run install:local
npm run install:systemd
systemctl --user enable aido
systemctl --user start aido
```

### Step 3 — Verify

```bash
aido --help
```

---

## Quick start

```bash
# 1. Add your Zen key
aido add sk-yourzenkey...

# 2. Configure your tools (Claude Code + OpenCode)
aido launch

# 3. Start the proxy
aido proxy

# 4. Test it
aido run "what is 2+2"
```

---

## Commands

### `aido add <key>`

Adds an API key. Provider is auto-detected from the key format.

```bash
aido add sk-zen-key-here...
aido add sk-ant-api03-anthropic-key...
aido add sk-proj-openai-key...

# Override detection
aido add some-key --provider groq
```

Stored in `.env` next to the project folder:
```
ZEN_KEYS=key1,key2,key3
ANTHROPIC_KEYS=key1
```

### `aido run <prompt>`

Sends a prompt to a model. Useful for quick testing.

```bash
aido run "what is 2+2"
aido run "write a haiku" --model mimo-v2-flash-free
aido run "explain recursion" --provider zen --stream
```

### `aido models [provider]`

Fetches available models using your key. Results cached for 1 hour.

```bash
aido models          # all configured providers
aido models zen      # specific provider
aido models --sync   # ignore cache, force refresh
```

> Since the call is made with your own key, you see exactly which models your account can use.
> A paid key may return more models than a free key.

Free models on OpenCode Zen (at time of writing):

| Model ID                  | Name                |
|---------------------------|---------------------|
| `big-pickle`              | Big Pickle          |
| `mimo-v2-flash-free`      | MiMo V2 Flash       |
| `nemotron-3-super-free`   | Nemotron 3 Super    |
| `minimax-m2.5-free`       | MiniMax M2.5        |

### `aido proxy`

Starts the proxy server on port 4141 (configurable via `PROXY_PORT` in `.env`).

```bash
aido proxy
# [aido-proxy] Listening on http://localhost:4141
```

Routes:
| URL                  | Forwards to     |
|----------------------|-----------------|
| `/v1/...`            | Zen (default)   |
| `/zen/v1/...`        | Zen explicit    |
| `/openai/v1/...`     | OpenAI          |
| `/anthropic/...`     | Anthropic       |

### `aido launch`

Configures Claude Code and/or OpenCode to use the proxy.

```bash
aido launch                    # both
aido launch --target claude    # Claude Code only
aido launch --target opencode  # OpenCode only
```

**Claude Code** — adds to `.bashrc` / `.zshrc`:
```bash
export ANTHROPIC_BASE_URL="http://localhost:4141/anthropic"
export ANTHROPIC_API_KEY="aido-proxy"
```

**OpenCode** — writes `~/.config/opencode/opencode.json`:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "aido/big-pickle",
  "provider": {
    "aido": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "AIdo Proxy (Zen)",
      "options": {
        "baseURL": "http://localhost:4141/v1",
        "apiKey": "aido-proxy"
      }
    }
  }
}
```

In OpenCode: `/models` → select `aido/big-pickle` or another model.

### `aido status`

Shows configured providers and any rate-limited keys.

```bash
aido status

# Configured providers:
#   zen          2 keys
#   openai       1 key
#
# Rate-limited keys (1):
#   zen          ...gooTF  (until 14:30:00)
```

### `aido stop`

Stops the running proxy server.

```bash
aido stop
```

### `aido hunt`

Searches the internet for leaked API keys and validates them automatically.

```bash
aido hunt                    # Search for keys (default: 3 valid keys, 60s timeout)
aido hunt --limit 5          # Stop after 5 valid keys
aido hunt --timeout 120      # Search for 2 minutes
aido hunt --provider zen     # Only search for Zen keys
aido hunt --provider anthropic  # Only search for Anthropic keys
```

#### How it works

1. **Web Search** — Uses Exa API to search for potential API keys in:
   - GitHub repositories and gists
   - Stack Overflow posts
   - Reddit discussions
   - Code sharing sites
   - Various web pages

2. **Key Extraction** — Extracts patterns matching `sk-` prefixed keys

3. **Filtering** — Filters out placeholder/fake keys like:
   - `your-key-here`, `xxx`, `your_api_key`
   - Keys that are too short or obviously test keys

4. **Validation** — Validates each key against the provider API

5. **Deduplication** — Tracks searched sources in SQLite, won't scan same URL twice within 24 hours

6. **Auto-add** — Valid keys are automatically added to your configuration

#### Daemon Mode

The hunt runs in daemon mode by default — it continuously searches in the background:
```bash
aido hunt --daemon           # Run continuously in background (default)
aido hunt --daemon=false     # Run once and exit
```

#### Requirements

- **EXA_API_KEY** — Get one at https://exa.ai (free tier available)
- **GITHUB_TOKEN** — For cloning private repositories (optional)

Add to `.env`:
```
EXA_API_KEY=your-exa-api-key
GITHUB_TOKEN=ghp_xxx  # Optional: for private repo scanning
```

---

### `aido key:validate <key>`

Validates if an API key works.

```bash
aido key:validate sk-xxx...
aido key:validate sk-xxx... --provider zen
```

### `aido clear`

Clears all rate limits, making all keys available again.

```bash
aido clear
```

---

## How rotation works

1. The next available (non-rate-limited) key is used
2. On a `429` response: key is marked in SQLite with a cooldown (default 1h, or from `Retry-After` header)
3. Request is retried with the next key (all available keys are tried)
4. If all keys are exhausted → `503` returned to the client

---

## Key format detection

| Format               | Provider   |
|----------------------|------------|
| `sk-ant-...`         | Anthropic  |
| `sk-proj-...`        | OpenAI     |
| `sk-` + 60+ chars    | Zen        |
| `sk-` + shorter      | OpenAI     |
| `gsk_...`            | Groq       |
| `AIza...`            | Google     |

---

## Auto-start on boot (systemd)

Run the proxy automatically when you log in using systemd user services.

### Install

```bash
npm run install:systemd
```

This creates a systemd service at `~/.config/systemd/user/aido.service`.

### Enable and start

```bash
systemctl --user enable aido
systemctl --user start aido
```

### Check status

```bash
systemctl --user status aido
```

### View logs

```bash
journalctl --user -u aido -f
```

### Stop and disable

```bash
systemctl --user stop aido
systemctl --user disable aido
```

### Uninstall

```bash
npm run uninstall:systemd
```

> **Note:** This only works on Linux systems with systemd. For macOS, use launchd (not included).

---

## Development

```bash
npm test            # run all tests
npm run test:watch  # watch mode
```

---

## Git setup

```bash
git init
git add .
git commit -m "init"

# .env and aido.db are in .gitignore — never committed
```
