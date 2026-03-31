# API Reference

## CLI Commands

### AIdo add

Adds an API key. Provider is auto-detected from key format.

```bash
AIdo add <key>                    # Auto-detect provider
AIdo add <key> --provider <name>  # Override provider
```

**Examples:**
```bash
AIdo add sk-opencode-key...
AIdo add sk-ant-anthropic-key...
AIdo add gsk_groq-key...
AIdo add sk-proj-openai-key...
```

### AIdo run

Sends a prompt to a model. Useful for quick testing.

```bash
AIdo run "<prompt>"              # Use default model
AIdo run "<prompt>" --model <model>
AIdo run "<prompt>" --provider <provider>
AIdo run "<prompt>" --stream     # Stream response
```

**Examples:**
```bash
AIdo run "what is 2+2"
AIdo run "write a haiku" --model mimo-v2-flash-free
AIdo run "explain recursion" --provider opencode --stream
```

### AIdo proxy

Starts the proxy server on port 4141 (configurable via `PROXY_PORT`).

```bash
AIdo proxy              # Default port 4141
AIdo proxy --port 8080  # Custom port
```

### AIdo launch

Configures Claude Code and/or OpenCode to use the proxy.

```bash
AIdo launch                 # Both Claude Code and OpenCode
AIdo launch --target claude    # Claude Code only
AIdo launch --target opencode  # OpenCode only
```

### AIdo status

Shows configured providers and any rate-limited keys.

```bash
AIdo status
```

**Output:**
```
Configured providers:
  opencode     2 keys

Rate-limited keys (1):
  opencode     ...gooTF  (until 14:30:00)
```

### AIdo clear

Clear all rate limits (force all keys available again).

```bash
AIdo clear
```

**Output:**
```
[clear] Cleared 4 rate limits.
```

### AIdo sync

Clear rate limits and refresh models from all providers.

```bash
AIdo sync
```

**Output:**
```
[sync] Cleared 4 key limits and 3 model limits.
[sync] Refreshing models from all providers...

  [opencode]
    minimax-m2.5-free [free]
    mimo-v2-pro-free [free]
    big-pickle [free]
    ...
  41 models total (7 free, 34 paid)
```

### AIdo stop

Stop the running proxy server.

```bash
AIdo stop
```

### AIdo hunt

Search for leaked API keys on the internet.

```bash
AIdo hunt                           # Run in daemon mode (default)
AIdo hunt --daemon=false            # Run once and exit
AIdo hunt --limit 5                 # Stop after 5 valid keys
AIdo hunt --timeout 120             # Search for 2 minutes
AIdo hunt --provider opencode            # Only search for OpenCode keys
```

### AIdo hunt:stop

Stop the running hunt daemon.

```bash
AIdo hunt:stop
```

### AIdo models

Fetches available models using your key. Results cached for 1 hour.

```bash
AIdo models              # All configured providers
AIdo models opencode          # Specific provider
AIdo models --sync       # Ignore cache, force refresh
```

## Proxy API Endpoints

The proxy forwards requests to upstream providers:

| Endpoint | Provider |
|----------|----------|
| `/v1/...` | OpenCode (default) |
| `/opencode/v1/...` | OpenCode |
| `/openai/v1/...` | OpenAI |
| `/anthropic/...` | Anthropic |

### Model Capabilities

The `/v1/models` endpoint returns enriched model data with capabilities:

```bash
curl http://localhost:4141/v1/models \
  -H "Authorization: Bearer aido-proxy"
```

```json
{
  "data": [
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
  ]
}
```

| Field | Description |
|-------|-------------|
| `context` | Maximum context window (tokens) |
| `input` | Maximum input tokens |
| `output` | Maximum output tokens |
| `allows` | Features: reasoning, text, image, pdf, video |

### Chat Completions

```bash
curl -X POST http://localhost:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer aido-proxy" \
  -d '{
    "model": "aido/opencode/big-pickle",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENCODE_KEYS` | OpenCode API keys (comma-separated) | - |
| `OPENAI_KEYS` | OpenAI API keys | - |
| `ANTHROPIC_KEYS` | Anthropic API keys | - |
| `GROQ_KEYS` | Groq API keys | - |
| `OLLAMA_KEYS` | Ollama API keys | - |
| `OLLAMA_HOST` | Ollama host URL | `http://localhost:11434` |
| `PROXY_PORT` | Proxy server port | `4141` |
| `DB_PATH` | SQLite database path | `./aido.db` |
