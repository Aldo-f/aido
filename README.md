# AIdo

Local API key rotation proxy for LLM providers.  
Automatically rotates keys on rate limits (429). Cooldowns tracked in SQLite.

> **AIdo** = **AI** + **Aldo** — Your personal AI helper for key rotation.

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

### Step 2 — Make the `AIdo` command available

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
AIdo --help
# or
aido --help
```

---

## Quick start

```bash
# 1. Add your OpenCode key
AIdo add sk-youropencodekey...

# 2. Configure your tools (Claude Code + OpenCode)
AIdo launch

# 3. Start the proxy
AIdo proxy

# 4. Test it
AIdo run "what is 2+2"
```

## Free Model Discovery

Use `--only-free` to only use free models, or `--only-paid` to only use paid models:

```bash
# Only use free models
AIdo run "test free models" --provider opencode --only-free

# Only use paid models  
AIdo run "use best model" --provider opencode --only-paid

# Use both free and paid (default)
AIdo run "hello" --provider opencode
```

---

## Commands

### `AIdo add <key>`

Adds an API key. Provider is auto-detected from the key format.

```bash
AIdo add sk-opencode-key-here...
AIdo add sk-ant-api03-anthropic-key...
AIdo add sk-proj-openai-key...
AIdo add sk-or-v1-openrouter-key...

# Override detection
AIdo add some-key --provider groq
```

Stored in `.env` next to the project folder:
```
OPENCODE_KEYS=key1,key2,key3
ANTHROPIC_KEYS=key1
```

### `AIdo run <prompt>`

Sends a prompt to a model. Useful for quick testing.

```bash
AIdo run "what is 2+2"
AIdo run "write a haiku" --model mimo-v2-flash-free
AIdo run "explain recursion" --provider opencode --stream
AIdo run "test free models" --provider opencode --only-free  # Only use free models
```

### `AIdo models [provider]`

Fetches available models using your key. Results cached for 1 hour.

```bash
AIdo models          # all configured providers
AIdo models opencode      # specific provider
AIdo models --sync   # ignore cache, force refresh
```

> Since the call is made with your own key, you see exactly which models your account can use.
> A paid key may return more models than a free key.

Free models on OpenCode (at time of writing):

| Model ID                  | Name                |
|---------------------------|---------------------|
| `big-pickle`              | Big Pickle          |
| `mimo-v2-flash-free`      | MiMo V2 Flash       |
| `nemotron-3-super-free`   | Nemotron 3 Super    |
| `minimax-m2.5-free`       | MiniMax M2.5        |

Free models available via OpenRouter:

| Model ID                                     | Name                     |
|----------------------------------------------|--------------------------|
| `nvidia/nemotron-3-super-120b-a12b:free`     | Nemotron 3 Super         |
| `openrouter/hunter-alpha`                    | Hunter Alpha             |
| `openrouter/healer-alpha`                    | Healer Alpha             |

### `AIdo proxy`

Starts the proxy server on port 4141 (configurable via `PROXY_PORT` in `.env`).

```bash
AIdo proxy
# [aido-proxy] Listening on http://localhost:4141
```

Routes:
| URL                  | Forwards to     |
|----------------------|-----------------|
| `/v1/...`            | OpenCode (default)   |
| `/opencode/v1/...`   | OpenCode explicit    |
| `/openai/v1/...`     | OpenAI          |
| `/anthropic/...`     | Anthropic       |

#### Model Capabilities

The `/v1/models` endpoint returns enriched model data with capabilities:

```json
{
  "id": "claude-3-5-haiku",
  "object": "model",
  "owned_by": "opencode",
  "capabilities": {
    "context": 200000,
    "input": 200000,
    "output": 100000,
    "allows": ["reasoning", "text", "image", "pdf"]
  }
}
```

- `context`: Maximum context window (tokens)
- `input`: Maximum input tokens
- `output`: Maximum output tokens
- `allows`: Features supported (reasoning, text, image, pdf, video)

### `AIdo launch`

Configures Claude Code and/or OpenCode to use the proxy.

```bash
AIdo launch                    # both
AIdo launch --target claude    # Claude Code only
AIdo launch --target opencode  # OpenCode only
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
      "name": "AIdo Proxy",
      "options": {
        "baseURL": "http://localhost:4141/v1",
        "apiKey": "aido-proxy"
      }
    }
  }
}
```

In OpenCode: `/models` → select `aido/big-pickle` or another model.

### `AIdo status`

Shows configured providers and any rate-limited keys.

```bash
AIdo status

# Configured providers:
#   opencode          2 keys
#   openai       1 key
#
# Rate-limited keys (1):
#   opencode          ...gooTF  (until 14:30:00)
```

### `AIdo stop`

Stops the running proxy server.

```bash
AIdo stop
```

### `AIdo hunt:stop`

Stops the running hunt daemon.

```bash
AIdo hunt:stop
```

### `AIdo hunt`

Searches the internet for leaked API keys and validates them automatically.

```bash
AIdo hunt                    # Search for keys (default: 3 valid keys, 60s timeout)
AIdo hunt --limit 5          # Stop after 5 valid keys
AIdo hunt --timeout 120      # Search for 2 minutes
AIdo hunt --provider opencode     # Only search for OpenCode keys
AIdo hunt --provider anthropic  # Only search for Anthropic keys
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
AIdo hunt --daemon           # Run continuously in background (default)
AIdo hunt --daemon=false     # Run once and exit
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

### `AIdo key:validate <key>`

Validates if an API key works.

```bash
AIdo key:validate sk-xxx...
AIdo key:validate sk-xxx... --provider opencode
```

### `AIdo clear`

Clears all rate limits, making all keys available again.

```bash
AIdo clear
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
| `sk-` + 60+ chars    | OpenCode     |
| `sk-` + shorter      | OpenAI     |
| `gsk_...`            | Groq       |
| `AIza...`            | Google     |
| `sk-or-v1-...`       | OpenRouter |

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

---

## Command Naming

The command can be written as either `AIdo` or `aido` — both work:

```bash
AIdo run "hello"    # Uppercase I (Aldo's AI helper)
aido run "hello"    # Lowercase i (traditional)
```

The name **AIdo** represents **AI** + **Aldo** — your personal AI helper for managing API keys and model routing.
