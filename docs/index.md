# AIDO - Intelligent AI CLI

A unified AI CLI that intelligently routes queries across multiple providers.

[Get Started](#quick-start) · [Commands](#commands) · [Configuration](#configuration) · [Providers](#providers)

---

## Features

- **Multi-Provider Support**: Ollama, Docker Model Runner, OpenCode Zen, Google Gemini, OpenAI
- **Intelligent Routing**: Automatically selects the best model for your query
- **OpenAI-Compatible Proxy**: Works with OpenCode and other OpenAI-compatible clients
- **Session Management**: Continue conversations across sessions

---

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Start the proxy
python aido.py serve

# Connect OpenCode to use AIDO
python aido.py connect opencode

# Query using AIDO (streaming enabled by default)
python aido.py run "Hello, help me write a function"
```

---

## Installation

### Option 1: pipx (Recommended)
```bash
pipx install git+https://github.com/aldo-f/aido.git
aido run "Hello"
```

### Option 2: Python (recommended for development)
```bash
pip install -r requirements.txt
python aido.py serve
```

### Option 3: Download Binary
Download pre-built binaries from [Releases](https://github.com/aldo-f/aido/releases)

---

## Commands

### Server

| Command | Description |
|---------|-------------|
| `aido serve [port]` | Start proxy server (default: 11999) |
| `aido stop` | Stop proxy server |
| `aido status` | Show provider status |

### Query

| Command | Description |
|---------|-------------|
| `aido run [query]` | Run a query |
| `aido run` | Start interactive mode |
| `aido run -c` | Continue last session |

### Models

| Command | Description |
|---------|-------------|
| `aido list` | List available models |
| `aido providers` | List providers |
| `aido pull [model]` | Download a model |

### Configuration

| Command | Description |
|---------|-------------|
| `aido init` | Check all providers |
| `aido connect opencode` | Configure OpenCode |
| `aido auth <provider>` | Open auth page |
| `aido key list` | List API keys |
| `aido key add <provider> <key>` | Add API key |

---

## Configuration

### Providers

AIDO supports multiple providers:

| Provider | Type | Requires Key |
|----------|------|--------------|
| ollama | Local | No |
| docker-model-runner | Local | No |
| opencode-zen | Cloud | Yes |
| gemini | Cloud | Yes |
| cloud | Cloud | Yes |

### Adding API Keys

```bash
# Open auth page to get API key
python aido.py auth zen

# Add the key to AIDO
python aido.py key add opencode-zen <your-api-key>

# List keys
python aido.py key list
```

---

## Architecture

```
┌─────────────┐    localhost:11999     ┌─────────────┐
│  OpenCode   │ ◄────────────────────► │  AIDO Proxy │
│  (client)  │   OpenAI-compatible    │             │
└─────────────┘                        └──────┬──────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
            ┌───────────────┐         ┌───────────────┐         ┌───────────────┐
            │  OpenCode Zen │         │    Ollama     │         │    Gemini     │
            │   (API key)  │         │   (local)     │         │   (API key)   │
            └───────────────┘         └───────────────┘         └───────────────┘
```

---

## Connect vs Auth

| Command | Purpose |
|---------|---------|
| `aido connect opencode` | Configure OpenCode to use AIDO as a provider |
| `aido auth zen` | Get OpenCode Zen API key |

**Flow:**
1. `aido connect opencode` - Configures OpenCode → AIDO available in OpenCode
2. `aido auth zen` - Gets API key
3. `aido key add opencode-zen <key>` - AIDO can use Zen models

---

## Examples

```bash
# Basic query
aido "How do I reverse a list in Python?"

# Interactive mode
aido run

# Use specific provider
aido -p ollama "Hello"

# List models
aido list

# Check status
aido status
```

---

## Links

- [GitHub](https://github.com/aldo-f/aido)
- [Report Issues](https://github.com/aldo-f/aido/issues)
