# Architecture

## Overview

AIdo is a local proxy server that sits between your applications and LLM providers. It handles:

1. **Key Rotation**: Automatically rotates API keys when rate limited
2. **Provider Selection**: Routes requests to appropriate providers based on model name
3. **Request Translation**: Converts between OpenAI-compatible and provider-specific formats

## Components

### Core Files

| File | Purpose |
|------|---------|
| `src/proxy.ts` | Main proxy server - handles HTTP requests |
| `src/auto.ts` | Auto-routing logic - forwardAuto(), forwardAutoFree() |
| `src/models/router.ts` | Model name parsing and routing |
| `src/rotator.ts` | Key rotation with model-specific rate limiting |
| `src/detector.ts` | Provider detection from key format |
| `src/db.ts` | SQLite operations (WAL mode), models table, model_limits table |
| `src/free-discovery.ts` | Free model identification logic for each provider |
| `src/hunt.ts` | Hunt daemon - searches for leaked API keys |
| `src/hunt-gitleaks.ts` | Gitleaks integration for repo scanning |
| `src/model-capabilities.ts` | Model capabilities database |
| `src/models.ts` | Model fetching and enrichment |

### Request Flow

```
Client Request
    │
    ▼
proxy.ts (resolveProvider)
    │
    ▼
router.ts (routeAidoModel)
    │
    ▼
auto.ts (forwardAuto or forwardAutoFree)
    │
    ├──► forwardAuto (provider-specific)
    │       ├──► Try free models for provider
    │       │       └──► Success → Return response
    │       │       └──► 429 → Mark rate limited, try next
    │       └──► Fallback to DEFAULT_MODELS[provider]
    │
    ├──► forwardAutoFree (cross-provider)
    │       ├──► Try free models for each provider
    │       │       └──► Success → Return response
    │       │       └──► 429 → Mark rate limited, try next
    │       └──► Fallback to forwardAuto
    │
    └──► ... (until success or all exhausted)
```

### Free Model Discovery

1. **Identification**: `identifyFreeModels()` uses provider-specific logic to determine if a model is free
2. **Caching**: Discovered free models saved to `models` table with `isFree` flag (1-hour TTL)
3. **Retrieval**: `getFreeModels()` queries `models` table with `WHERE isFree = 1`
4. **Usage**: `aido run` tries free models first, falls back to paid models

### Database Schema

**Models Table** (renamed from `free_models`):
- Stores ALL models (free and paid) with `isFree` flag
- Enables filtering by `isFree = 1` to get only free models
- Primary key: `(provider, model_id)`

**Model Limits Table** (NEW):
- Tracks rate limits per model, not just per key
- Primary key: `(provider, model_id)`

## Provider Selection

### Priority Chains

AIdo uses priority chains to determine which providers to try:

- **Auto** (`aido/auto`): Zen → Ollama-Local → Ollama → Groq → OpenAI → Anthropic → OpenRouter
- **Cloud** (`aido/cloud`): Zen → Groq → OpenAI → Anthropic → Ollama → OpenRouter
- **Local** (`aido/local`): Ollama-Local

### Free Model Priority

When using `--auto-free` flag or free model discovery:
1. Query all providers for free models
2. Try free models across all providers before falling back to paid models
3. Skip rate-limited models using `model_limits` table

### Model Naming

Model names encode provider and model information:

```
aido/auto          → Auto-select best model
aido/cloud         → Cloud auto-select
aido/local         → Local auto-select
aido/zen/big-pickle    → Zen provider, specific model
aido/ollama/qwen3:8b   → Ollama Cloud, specific model
```

## Key Rotation

### How It Works

1. On request, rotator selects next available key
2. If 429 response, key is marked with cooldown (default 1h)
3. Cooldown tracked in SQLite database
4. After cooldown expires, key becomes available again

### Key Format Detection

| Key Format | Provider |
|------------|---------|
| `sk-ant-...` | Anthropic |
| `sk-proj-...` | OpenAI |
| `sk-` + 60+ chars | Zen |
| `gsk_...` | Groq |
| `AIza...` | Google |
| 32 hex + `.` + alphanumeric | Ollama |
| `sk-or-v1-...` | OpenRouter |

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ZEN_KEYS` | Comma-separated Zen API keys |
| `OPENAI_KEYS` | Comma-separated OpenAI API keys |
| `ANTHROPIC_KEYS` | Comma-separated Anthropic API keys |
| `GROQ_KEYS` | Comma-separated Groq API keys |
| `OLLAMA_KEYS` | Comma-separated Ollama API keys |
| `OPENROUTER_KEYS` | Comma-separated OpenRouter API keys |
| `OLLAMA_HOST` | Ollama host URL (default: http://localhost:11434) |
| `PROXY_PORT` | Proxy port (default: 4141) |
| `DB_PATH` | SQLite database path (default: aido.db) |

## Model Capabilities

The proxy enriches `/v1/models` responses with capability data:

```json
{
  "id": "claude-3-5-haiku",
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
- `allows`: Supported features (reasoning, text, image, pdf, video)

Capabilities are looked up from a hardcoded database in `src/model-capabilities.ts` since provider APIs don't always return this information.
