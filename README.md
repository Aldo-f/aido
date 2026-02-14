# AIDO - Intelligent AI Assistant

A unified AI CLI that intelligently routes queries across multiple providers (Ollama, Docker Model Runner, OpenCode Zen, Google Gemini, OpenAI).

## Quick Start

```bash
# 1. Start the proxy
./aido.sh serve

# 2. Connect OpenCode to use AIDO
./aido.sh connect opencode

# 3. Restart OpenCode

# 4. Query using AIDO
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
| cloud | OpenAI | Yes |

## Architecture

```
┌─────────────┐    localhost:11999     ┌─────────────┐
│  OpenCode   │ ◄────────────────────► │  AIDO Proxy │
│  (client)  │   OpenAI-compatible    │  (your AI)  │
└─────────────┘                        └──────┬──────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
            ┌───────────────┐         ┌───────────────┐         ┌───────────────┐
            │  OpenCode Zen │         │    Ollama     │         │    Gemini     │
            │   (API key)  │         │   (local)     │         │   (API key)   │
            └───────────────┘         └───────────────┘         └───────────────┘
```

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
