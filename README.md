# AIDO - Intelligent AI Assistant

A unified AI CLI that intelligently routes queries across multiple providers (Ollama, Docker Model Runner, OpenCode Zen, Google Gemini, OpenAI). Built with FastAPI for optimal performance.

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the proxy
./aido.sh serve

# 3. Connect OpenCode to use AIDO
./aido.sh connect opencode

# 4. Restart OpenCode

# 5. Query using AIDO
./aido.sh run "Hello, help me write a function"

# Or use directly
./aido.sh "Hello"
```

## Commands

| Command | Description |
|---------|-------------|
| `aido serve [port]` | Start proxy server (default: 11999) |
| `aido stop` | Stop proxy server |
| `aido status` | Show provider status |
| `aido list` | List available models |
| `aido run [query]` | Run a query or start interactive mode |
| `aido pull [model]` | Download a model |
| `aido init` | Check all providers |

## Meta Models

AIDO provides special meta-models for intelligent routing:

| Model | Behavior |
|-------|----------|
| `aido/auto` | Auto-select based on selection mode |
| `aido/cloud` | Only use cloud providers (Zen, Gemini, OpenAI) |
| `aido/local` | Only use local providers (Ollama, DMR) |

```bash
# Use with OpenCode
opencode -m aido/auto run "Hello"

# Or via API
curl -X POST http://localhost:11999/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "aido/auto", "messages": [{"role": "user", "content": "Hello"}]}'
```

## Configuration

### Connect to OpenCode

```bash
./aido.sh connect opencode
```

This configures OpenCode to use AIDO as a provider. After running:
1. Restart OpenCode
2. Run `aido serve`

### Add API Keys

To use cloud providers (Zen, Gemini, OpenAI), add API keys:

```bash
# Open auth page to get API key
./aido.sh auth zen

# Add the key to AIDO
./aido key add opencode-zen <your-api-key>

# Check keys
./aido key list

# Test keys
./aido key test opencode-zen
```

### Providers

AIDO supports multiple providers:

| Provider | Description | Requires Key |
|----------|-------------|--------------|
| ollama | Local Ollama instance | No |
| docker-model-runner | Docker Model Runner | No |
| opencode-zen | OpenCode Zen | Yes |
| gemini | Google Gemini | Yes |
| openai | OpenAI | Yes |

### Multi-Key Support

You can add multiple API keys per provider. AIDO automatically handles:
- **Rate limits (HTTP 429)**: Tries next key
- **Auth errors (HTTP 401/403)**: Tries next key
- **All keys failed**: Tries next provider

```bash
# Add multiple keys
./aido key add opencode-zen sk-zen-xxx-1 "primary"
./aido key add opencode-zen sk-zen-xxx-2 "backup"

# List keys
./aido key list

# Delete a key by index
./aido key delete opencode-zen 1

# Delete all keys
./aido key delete-all opencode-zen

# Test all keys
./aido key test opencode-zen
```

### Model Selection

AIDO supports three selection modes controlled by `selection.default_mode` in config:

| Mode | Behavior |
|------|----------|
| `cloud_first` | Prefer cloud providers (Zen, Gemini, OpenAI) first, fall back to local |
| `local_first` | Prefer local providers (Ollama, DMR) first, fall back to cloud |
| `auto` | Use cloud if keys available, otherwise local (default) |

```bash
# View current config
./aido --config | jq '.selection'

# Change to cloud_first
./aido --config | jq '.selection = {"default_mode": "cloud_first"}' > /tmp/c.json
mv /tmp/c.json ~/.aido-data/config.json

# Change to local_first
./aido --config | jq '.selection = {"default_mode": "local_first"}' > /tmp/c.json
mv /tmp/c.json ~/.aido-data/config.json
```

**Selection Priority:**
- `cloud_first`: OpenCode Zen → Gemini → OpenAI → Ollama → DMR
- `local_first`: Ollama → DMR → OpenCode Zen → Gemini → OpenAI

## Architecture

```
┌─────────────┐    localhost:11999     ┌─────────────┐
│  OpenCode   │ ◄────────────────────► │  AIDO Proxy │
│  (client)  │   OpenAI-compatible    │  (FastAPI)  │
└─────────────┘                        └──────┬──────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    ▼                          ▼                          ▼
            ┌───────────────┐          ┌───────────────┐          ┌───────────────┐
            │  OpenCode Zen │          │    Ollama     │          │    Gemini     │
            │   (API key)  │          │   (local)     │          │   (API key)   │
            └───────────────┘          └───────────────┘          └───────────────┘
```

### Key Features

- **FastAPI**: High-performance async server
- **Key Rotation**: Automatic retry with next key on 401/403/429
- **Provider Fallback**: Cloud → Local fallback chain
- **SSE Filtering**: Removes SSE comments from streaming responses
- **Meta Models**: `aido/auto`, `aido/cloud`, `aido/local`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check + provider status |
| `/v1/models` | GET | List all available models |
| `/v1/chat/completions` | POST | OpenAI-compatible chat |
| `/chat/completions` | POST | Same as above (without /v1) |

## OpenCode Integration

### What does `aido connect opencode` do?

This command (similar to `ollama launch`) configures OpenCode to use AIDO as a provider:

1. Creates/updates `~/.config/opencode/opencode.jsonc`
2. Adds AIDO provider with `baseURL: http://localhost:11999`
3. Preserves existing OpenCode providers

### What does `aido auth zen` do?

Opens the OpenCode Zen auth page where you can:
- Log in to your OpenCode account
- Generate an API key

After getting the key, add it with:
```bash
aido key add opencode-zen <your-api-key>
```

## Examples

```bash
# Query with auto model selection
aido "How do I reverse a list in Python?"

# Use specific model
aido -p ollama "Hello"

# Interactive mode
aido run

# Continue last session
aido run -c

# List models
aido list

# Check status
aido status
```

## Install Globally

```bash
./aido.sh --install
```

This installs `aido` to `/usr/local/bin/aido`.

## Development

### File Structure

```
aido/
├── aido.sh               # Main CLI
├── requirements.txt      # Python dependencies (FastAPI, uvicorn, httpx)
├── proxy/
│   ├── config.py         # Config loading, provider detection
│   ├── key_manager.py    # Multi-key rotation with failure tracking
│   ├── server.py         # FastAPI main application
│   └── providers/
│       ├── zen.py        # OpenCode Zen provider
│       ├── gemini.py     # Google Gemini provider
│       ├── openai.py     # OpenAI provider
│       ├── ollama.py     # Ollama (local) provider
│       └── dmr.py        # Docker Model Runner provider
└── tests/
    └── aido_test.sh
```

### Debug

```bash
# Check logs
tail -f ~/.aido-data/logs/proxy.log

# Manual test
curl http://localhost:11999/health
curl http://localhost:11999/v1/models
```
