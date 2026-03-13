# API Reference

## CLI Commands

### aido add

Adds an API key. Provider is auto-detected from key format.

```bash
aido add <key>                    # Auto-detect provider
aido add <key> --provider <name>  # Override provider
```

**Examples:**
```bash
aido add sk-zen-key...
aido add sk-ant-anthropic-key...
aido add gsk_groq-key...
aido add sk-proj-openai-key...
```

### aido run

Sends a prompt to a model. Useful for quick testing.

```bash
aido run "<prompt>"              # Use default model
aido run "<prompt>" --model <model>
aido run "<prompt>" --provider <provider>
aido run "<prompt>" --stream     # Stream response
```

**Examples:**
```bash
aido run "what is 2+2"
aido run "write a haiku" --model mimo-v2-flash-free
aido run "explain recursion" --provider zen --stream
```

### aido proxy

Starts the proxy server on port 4141 (configurable via `PROXY_PORT`).

```bash
aido proxy              # Default port 4141
aido proxy --port 8080  # Custom port
```

### aido launch

Configures Claude Code and/or OpenCode to use the proxy.

```bash
aido launch                 # Both Claude Code and OpenCode
aido launch --target claude    # Claude Code only
aido launch --target opencode  # OpenCode only
```

### aido status

Shows configured providers and any rate-limited keys.

```bash
aido status
```

**Output:**
```
Configured providers:
  zen          2 keys
  openai       1 key

Rate-limited keys (1):
  zen          ...gooTF  (until 14:30:00)
```

### aido clear

Clear all rate limits (force all keys available again).

```bash
aido clear
```

**Output:**
```
[clear] Cleared 4 rate limits.
```

### aido models

Fetches available models using your key. Results cached for 1 hour.

```bash
aido models              # All configured providers
aido models zen          # Specific provider
aido models --sync       # Ignore cache, force refresh
```

## Proxy API Endpoints

The proxy forwards requests to upstream providers:

| Endpoint | Provider |
|----------|----------|
| `/v1/...` | Zen (default) |
| `/zen/v1/...` | Zen |
| `/openai/v1/...` | OpenAI |
| `/anthropic/...` | Anthropic |

### Chat Completions

```bash
curl -X POST http://localhost:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer aido-proxy" \
  -d '{
    "model": "aido/zen/big-pickle",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ZEN_KEYS` | Zen API keys (comma-separated) | - |
| `OPENAI_KEYS` | OpenAI API keys | - |
| `ANTHROPIC_KEYS` | Anthropic API keys | - |
| `GROQ_KEYS` | Groq API keys | - |
| `OLLAMA_KEYS` | Ollama API keys | - |
| `OLLAMA_HOST` | Ollama host URL | `http://localhost:11434` |
| `PROXY_PORT` | Proxy server port | `4141` |
| `DB_PATH` | SQLite database path | `./aido.db` |
