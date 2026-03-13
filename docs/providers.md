# Providers

## Supported Providers

| Provider | Key Format | Base URL |
|----------|------------|----------|
| Zen | `sk-` + 60+ chars | `https://opencode.ai/zen/v1` |
| OpenAI | `sk-proj-...` or `sk-` + ~48 chars | `https://api.openai.com/v1` |
| Anthropic | `sk-ant-...` | `https://api.anthropic.com` |
| Groq | `gsk_...` | `https://api.groq.com/openai/v1` |
| Google | `AIza...` | `https://generativelanguage.googleapis.com/v1beta` |
| Ollama (Cloud) | 32 hex + `.` + alphanumeric | `https://ollama.com/api` |
| Ollama (Local) | No key needed | `http://localhost:11434/v1` |

## Model Selection

### aido/auto

Auto-selects the best available model from all providers:

1. Zen (big-pickle)
2. Ollama-Local (qwen3:8b)
3. Ollama (glm-5:cloud)
4. Groq (llama-3.1-8b-instant)
5. OpenAI (gpt-4o-mini)
6. Anthropic (claude-haiku-4-5)

### aido/cloud

Selects from cloud providers only:

1. Zen (big-pickle)
2. Groq (llama-3.1-8b-instant)
3. OpenAI (gpt-4o-mini)
4. Anthropic (claude-haiku-4-5)
5. Ollama-Local (glm-5:cloud) - local cloud models

### aido/local

Selects from local Ollama:

1. Ollama-Local (qwen3:8b)

### Specific Provider

Use `aido/<provider>/<model>` for specific provider and model:

```bash
aido run "prompt" --model aido/zen/big-pickle
aido run "prompt" --model aido/ollama/qwen3:8b
aido run "prompt" --model aido/groq/llama3-8b-8192
```

## Key Rotation

### On Rate Limit (429)

When a provider returns 429:

1. Current key is marked as rate-limited
2. Cooldown starts (default 1 hour, or from `Retry-After` header)
3. Next request uses next available key
4. Original key becomes available again after cooldown

### Key Selection Strategy

- Round-robin within available (non-rate-limited) keys
- Each key tried once per rotation cycle
- Rate-limited keys skipped until cooldown expires

## Provider-Specific Notes

### Zen

- Primary provider for free models
- Supports OpenAI-compatible API
- Models: big-pickle, mimo-v2-flash-free, nemotron-3-super-free, minimax-m2.5-free

### OpenAI

- Standard OpenAI API
- Models: gpt-4o, gpt-4o-mini, etc.

### Anthropic

- Uses Anthropic-specific headers
- Models: claude-3-5-sonnet, claude-3-haiku, etc.

### Groq

- Fast inference, free tier available
- Models: llama-3.1-8b-instant, llama-3.1-70b-versatile, etc.

### Ollama (Cloud)

- Cloud variants of Ollama models
- Uses native Ollama format (not OpenAI-compatible)
- Models: glm-5:cloud, kimi-k2.5:cloud, minimax-m2.5:cloud

### Ollama (Local)

- Locally running Ollama server
- No API key needed
- Configure via `OLLAMA_HOST` environment variable
- Use `ollama list` to see available models
