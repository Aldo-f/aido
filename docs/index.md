# AIdo - Local API Key Rotation Proxy

AIdo is a local API key rotation proxy for LLM providers. It automatically rotates keys on rate limits (429) and tracks cooldowns in SQLite.

## Features

- **Automatic Key Rotation**: Automatically switches to the next available key when rate limited
- **Multiple Providers**: Supports Zen, OpenAI, Anthropic, Groq, Google, and Ollama
- **Cloud & Local Models**: Auto-selects best available model based on category
- **Model Routing**: Uses model names like `aido/zen/big-pickle` to route to specific providers
- **SQLite Persistence**: Tracks rate-limited keys and their cooldown times

## Quick Start

```bash
# Add your Zen key
aido add sk-yourzenkey...

# Configure your tools
aido launch

# Start the proxy
aido proxy

# Test it
aido run "what is 2+2"
```

## Model Selection

| Model | Description |
|-------|-------------|
| `aido/auto` | Auto-select best available model |
| `aido/cloud` | Cloud models (Zen, Groq, OpenAI, Anthropic, Ollama) |
| `aido/local` | Local Ollama models |
| `aido/zen/big-pickle` | Specific provider and model |

## Commands

- `aido add <key>` - Add an API key
- `aido run <prompt>` - Run a prompt
- `aido proxy` - Start the proxy server
- `aido launch` - Configure Claude Code/OpenCode to use the proxy
- `aido status` - Show configured providers

See [API Reference](api.md) for detailed command documentation.
