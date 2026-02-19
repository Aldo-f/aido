# Commands

Complete reference for all AIDO commands.

---

## Server Commands

| Command | Description |
|---------|-------------|
| `aido serve [port]` | Start proxy server (default: 11999) |
| `aido stop` | Stop proxy server |
| `aido status` | Show proxy and provider status |

---

## Query Commands

| Command | Description |
|---------|-------------|
| `aido run [query]` | Run a query |
| `aido run` | Start interactive mode |
| `aido run --no-stream` | Run without streaming |

---

## Model Commands

| Command | Description |
|---------|-------------|
| `aido list` | List available models |
| `aido providers` | List configured providers |
| `aido pull [model]` | Download a model (Ollama) |

---

## Configuration Commands

| Command | Description |
|---------|-------------|
| `aido init` | Check all providers and configuration |
| `aido connect opencode` | Configure OpenCode to use AIDO |
| `aido auth [provider]` | Open auth page for provider |

---

## Key Management

| Command | Description |
|---------|-------------|
| `aido key list` | List all API keys |
| `aido key add <provider> <key> [name]` | Add API key |
| `aido key delete <provider> <index>` | Delete API key |
| `aido key delete-all <provider>` | Delete all keys for provider |

### Examples

```bash
# List keys
aido key list

# Add a key
aido key add opencode-zen sk-zen-xxx "my-key"

# Delete a key
aido key delete opencode-zen 0
```

---

## Session Management

| Command | Description |
|---------|-------------|
| `aido session list` | List all sessions |
| `aido session new [name]` | Create new session |
| `aido session delete [name]` | Delete a session |

---

## Help

```bash
# Show general help
aido --help

# Show command-specific help
aido serve --help
aido run --help
aido key --help
```
