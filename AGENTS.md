# AGENTS.md - AIDO Development Guide

## Overview

AIDO is an intelligent AI CLI assistant with multi-provider support (Ollama, Docker Model Runner, OpenCode Zen, Google Gemini, OpenAI).

---

## Commands

### Running Tests

```bash
# Run all tests
make test

# Run tests directly
cd /media/aldo/shared/aido && ./tests/aido_test.sh

# Run with custom test directory
AIDO_TEST_DIR=/tmp/aido-test ./tests/aido_test.sh
```

### Lint & Format

```bash
# Install formatters
make install-tools

# Check code (lint)
make lint

# Auto-format code
make format

# Run lint + test
make all
```

### Individual Commands

```bash
# Format Bash
shfmt -w aido.sh

# Format Python
ruff format proxy/

# Lint Bash
shfmt -d aido.sh

# Lint Python
ruff check proxy/
```

### Server Commands

```bash
./aido.sh serve          # Start proxy (default port 11999)
./aido.sh serve 8080     # Custom port
./aido.sh stop           # Stop proxy
./aido.sh status         # Check status
```

### Query Commands

```bash
./aido.sh run "Hello"    # Run query
./aido.sh run            # Interactive mode
./aido.sh run -c         # Continue last session
./aido.sh list           # List available models
./aido.sh pull llama3.2  # Download model
```

---

## Code Style - Bash

### General Rules
- Use `set -euo pipefail` at script top
- Use `[[ ]]` for conditionals (not `[ ]`)
- Use `$(command)` not backticks
- Double-quote all variable expansions: `"$variable"`

### Naming & Formatting
- Variables: `lower_case_with_underscores`
- Functions: `snake_case`
- Constants: `UPPER_CASE`
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

---

## Code Style - Python

### General Rules
- Python 3.8+ (type hints, f-strings)
- 100 character line limit, 4-space indent

### Imports (stdlib only)
```python
import os
import sys
import json
import signal
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
```

### Type Hints
```python
def function(param: str) -> int:
    ...

def optional_param(name: str, value: str | None = None) -> dict[str, Any]:
    ...
```

### Naming
- Functions/variables: `snake_case`
- Classes: `PascalCase`
- Constants: `UPPER_CASE`
- Private: `_private_function()`

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
- Use `log()` function from server.py
- Levels: "INFO", "WARN", "ERROR"
- Include request IDs: `log(f"[{request_id}] message")`

---

## File Structure

```
aido/
├── Makefile              # Build/lint/format commands
├── aido.sh              # Main CLI (62KB)
├── proxy/
│   ├── __init__.py
│   ├── database.py
│   └── server.py        # HTTP proxy server
├── tests/
│   ├── aido_test.sh
│   └── aido_opencode_test.py
└── AGENTS.md            # This file
```

---

## Configuration

Config: `~/.aido-data/config.json`

### Selection Modes

| Mode | Behavior |
|------|----------|
| `cloud_first` | Prefer cloud (Zen, Gemini, OpenAI), fallback to local |
| `local_first` | Prefer local (Ollama, DMR), fallback to cloud |
| `auto` | Use cloud if keys available, otherwise local |

### Provider Config
```json
{
  "providers": {
    "ollama": {"enabled": true, "endpoint": "http://localhost:11434"},
    "opencode-zen": {"enabled": true, "keys": [{"key": "sk-zen-xxx", "name": "primary"}]}
  },
  "selection": {"default_mode": "cloud_first"}
}
```

### Multi-Key Support
- Keys tried sequentially
- On HTTP 429/401/403, skip to next key

---

## Development Tips

1. **Debug**: Use `--debug` flag for verbose output
2. **Test isolation**: Use `AIDO_TEST_DIR` env var
3. **Proxy logs**: Check `~/.aido-data/logs/proxy.log`
4. **Quick restart**: Stop/start proxy to pick up config changes
