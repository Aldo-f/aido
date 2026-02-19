# Usage

AIDO provides a simple command-line interface for interacting with AI models.

---

## Basic Usage

```bash
# Query with streaming (default)
aido run "Hello, how are you?"

# Query without streaming
aido run --no-stream "Hello"

# Interactive mode
aido run
```

---

## Starting the Proxy

Before running queries, you need to start the proxy:

```bash
# Start proxy (default port 11999)
aido serve

# Start on custom port
aido serve 8080

# Stop the proxy
aido stop

# Check status
aido status
```

---

## Interactive Mode

```bash
# Start interactive mode
aido run

# Commands in interactive mode
> Hello                    # Send a query
> /help                    # Show help
> /models                  # List available models
> /status                  # Show proxy status
> /exit                    # Exit
```

---

## Model Selection

AIDO supports several meta-models:

| Model | Description |
|-------|-------------|
| `aido/auto` | Auto-select based on configuration |
| `aido/cloud` | Use cloud providers only |
| `aido/local` | Use local providers only |

```bash
# Use specific model
aido run -m aido/local "Hello"
```

---

## Examples

```bash
# Basic query
aido run "How do I reverse a list in Python?"

# Get help with a coding problem
aido run "Explain async/await in Python"

# Continue a conversation (interactive mode)
aido run

# List available models
aido list

# Check provider status
aido status
```
