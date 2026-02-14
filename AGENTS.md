# AGENTS.md - AIDO Development Guide

## Overview

AIDO is an intelligent AI CLI assistant with multi-provider support (Ollama, Docker Model Runner, OpenCode Zen, Google Gemini, OpenAI). The codebase consists of:
- **Bash**: `aido.sh` (main CLI), `tests/aido_test.sh` (test suite)
- **Python**: `proxy/server.py` (HTTP proxy server)

---

## Commands

### Running Tests

```bash
# Run all tests (using Makefile)
make test

# Run all tests (direct)
cd /media/aldo/shared/aido && ./tests/aido_test.sh

# Run with specific home directory
HOME=/tmp/test-home ./tests/aido_test.sh

# Run with custom test data directory
AIDO_TEST_DIR=/tmp/aido-test ./tests/aido_test.sh
```

## Development Commands

### Using Makefile (recommended)
```bash
# Install formatters (shfmt, ruff)
make install-tools

# Check code without modifying (lint)
make lint

# Auto-format code
make format

# Run tests
make test

# Run lint + test
make all
```

### Individual Commands

```bash
# Format Bash
shfmt -w aido.sh

# Format Python
ruff format proxy/

# Lint Bash (check only)
shfmt -d aido.sh

# Lint Python
ruff check proxy/
```

### Install Formatters Manually

```bash
# macOS
brew install shfmt
pip install ruff

# Linux
apt-get install shfmt
pip install ruff
```

### Server Commands

```bash
# Start proxy on default port 11999
./aido.sh serve

# Start on custom port
./aido.sh serve 8080

# Stop proxy
./aido.sh stop

# Check status
./aido.sh status
```

### Query Commands

```bash
# Run a query
./aido.sh run "Hello"

# Interactive mode
./aido.sh run

# Continue last session
./aido.sh run -c
```

### Model Commands

```bash
# List available models
./aido.sh list

# List providers
./aido.sh providers

# Download model
./aido.sh pull llama3.2:latest
```

### Session Commands

```bash
# List sessions
./aido.sh session list

# Create new session
./aido.sh session new <name>

# Delete session
./aido.sh session delete <name>
```

### Configuration Commands

```bash
# Check all providers
./aido.sh init

# Connect OpenCode to use AIDO
./aido.sh connect opencode

# Open auth page
./aido.sh auth zen
./aido.sh auth gemini
./aido.sh auth openai

# Manage API keys
./aido.sh key list
./aido.sh key add <provider> <key> [name]
./aido.sh key delete <provider> <index>
./aido.sh key delete-all <provider>
./aido.sh key test <provider>
```

### Other Options

```bash
# Install globally
./aido.sh --install

# Show version
./aido.sh --version
./aido.sh -v

# Show config
./aido.sh --config

---

## Code Style - Bash

### General Rules
- Use `set -euo pipefail` at the top of all scripts
- Use `[[ ]]` for conditionals (not `[ ]`)
- Use `$(command)` for command substitution (not backticks)
- Double-quote all variable expansions: `"$variable"`

### Naming Conventions
- Variables: `LOWER_CASE_WITH_UNDERSCORES`
- Functions: `snake_case`
- Constants: `UPPER_CASE`
- Boolean variables: Use `true`/`false` strings, not `0`/`1`

### Formatting
- Indent with 4 spaces, opening brace on same line
- Use `local` variables in functions

### Error Handling
```bash
function risky_command() {
    local result
    result=$(command_that_might_fail 2>/dev/null) || {
        error "Failed to do something"
        return 1
    }
    echo "$result"
}
```

### Conditionals
```bash
if [ "$var" = "value" ]; then
if [ -f "$file" ]; then
if command; then
if ! command; then
```

---

## Code Style - Python

### General Rules
- Use Python 3.8+ features (type hints, f-strings)
- 100 character line limit
- 4-space indent (no tabs)

### Imports
```python
import os
import sys
import json
import signal
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# No third-party imports (stdlib only)
```

### Type Hints
```python
def function(param: str) -> int:
    ...

def optional_param(name: str, value: str | None = None) -> dict[str, Any]:
    ...
```

### Naming Conventions
- Functions/variables: `snake_case`
- Classes: `PascalCase`
- Constants: `UPPER_CASE`
- Private functions: `_private_function()`

### Docstrings
```python
def load_config():
    """Load config from file.
    
    Returns:
        dict: Configuration dictionary.
    """
```

### Error Handling
```python
def safe_operation():
    try:
        result = risky_call()
    except ValueError as e:
        log(f"Value error: {e}", "ERROR")
        return None
    except Exception as e:
        log(f"Unexpected error: {e}", "ERROR")
        raise
```

### Logging
- Use the `log()` function in server.py
- Levels: "INFO", "WARN", "ERROR"
- Include request IDs: `log(f"[{request_id}] message")`

---

## File Structure

```
aido/
├── Makefile                # Build/lint/format commands
├── README.md              # User documentation
├── aido.sh               # Main CLI
├── proxy/
│   ├── __init__.py
│   ├── database.py
│   └── server.py         # HTTP proxy server
├── docs/                  # GitHub Pages documentation
│   └── index.md
├── tests/
│   ├── aido_test.sh      # Test suite
│   └── aido_opencode_test.py
├── .gitignore
└── AGENTS.md             # This file
```

---

## Configuration

Config stored in: `~/.aido-data/config.json`

Key settings:
- `model_preference`: "cloud_first", "local_first", or "auto"
- `api_mode`: "chat" or "generate" (default: generate)

### Provider Configuration

```json
{
  "providers": {
    "ollama": {
      "enabled": true,
      "endpoint": "http://localhost:11434"
    },
    "docker-model-runner": {
      "enabled": true,
      "endpoint": "http://localhost:12434"
    },
    "opencode-zen": {
      "enabled": true,
      "keys": [
        {"key": "sk-zen-xxx-1", "name": "primary"},
        {"key": "sk-zen-xxx-2", "name": "backup"}
      ]
    },
    "gemini": {
      "enabled": true,
      "keys": [
        {"key": "gemini-api-key"}
      ]
    }
  }
}
```

Multi-key support:
- Keys are tried sequentially
- On HTTP 429 (rate limit) or 401/403 (auth error), the key is skipped and the next key is tried
- Optional `name` field for key identification

### Connect vs Auth (OpenCode Integration)

Understanding the difference between `connect` and `auth`:

| Command | Purpose | Example |
|---------|---------|---------|
| `aido connect opencode` | Configure OpenCode to use AIDO as a provider | Similar to `ollama launch` |
| `aido auth zen` | Open OpenCode Zen auth page to get API key | Opens browser to opencode.ai/auth |

**Flow:**
```
aido connect opencode
    └── Configures OpenCode → AIDO can now be used in OpenCode

aido auth zen
    └── Gets API key → Then add with: aido key add opencode-zen <key>
        └── AIDO can now use Zen models
```

**Why separate?**
- `connect` is for **external tools** (OpenCode) to use AIDO
- `auth` is for **adding credentials** to AIDO so it can access cloud providers

## Development Tips

1. **Debug mode**: Use `--debug` flag for verbose output
2. **Test isolation**: Use `AIDO_TEST_DIR` env var
3. **Proxy logging**: Check `~/.aido-data/logs/proxy.log`
4. **Quick restart**: Stop/start proxy to pick up config changes
