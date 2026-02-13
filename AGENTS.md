# AGENTS.md - AIDO Development Guide

## Overview

AIDO is an intelligent AI CLI assistant with multi-provider support (Ollama, Docker Model Runner, Cloud). The codebase consists of:
- **Bash**: `aido.sh` (main CLI), `tests/aido_test.sh` (test suite)
- **Python**: `proxy/server.py` (HTTP proxy server)

---

## Commands

### Running Tests

```bash
# Run all tests
cd /media/aldo/shared/aido && ./tests/aido_test.sh

# Run a single test by name
cd /media/aldo/shared/aido && AIDO_TEST_DIR=/tmp/aido-test bash -c '
  source ./tests/aido_test.sh
  test_name() { echo "test content" && return 0; }
  test_name
'

# Run with specific home directory
HOME=/tmp/test-home ./tests/aido_test.sh
```

### Python Linting

```bash
# Run ruff linter (project uses ruff)
cd /media/aldo/shared/aido && python3 -m ruff check proxy/

# Auto-fix issues
cd /media/ado/shared/aido && python3 -m ruff check proxy/ --fix
```

### Starting the Proxy

```bash
# Start proxy on default port 11999
./aido.sh proxy start

# Start on custom port
./aido.sh proxy start --port 8080

# Check status
./aido.sh proxy status

# Stop proxy
./aido.sh proxy stop
```

### General CLI Usage

```bash
# Install globally
./aido.sh --install

# List models
./aido.sh --list

# Show status
./aido.sh --status

# Interactive mode
./aido.sh --interactive
```

---

## Code Style - Bash

### General Rules
- Use `set -euo pipefail` at the top of all scripts
- Use `[[ ]]` for conditionals (not `[ ]`)
- Use `$(command)` for command substitution (not backticks)
- Double-quote all variable expansions: `"$variable"`

### Naming Conventions
- Variables: `LOWER_CASE_WITH_UNDERSCORES` (e.g., `PROVIDER_MODE`)
- Functions: `snake_case` (e.g., `detect_providers`)
- Constants: `UPPER_CASE` (e.g., `OLLAMA_ENDPOINT`)
- Boolean variables: Use `true`/`false` strings, not `0`/`1`

### Formatting
- Indent with 4 spaces
- Opening brace on same line: `do_something() {`
- Use local variables in functions: `local var_name`
- Use descriptive variable names (no single letters except in loops)

### Error Handling
```bash
# Proper error handling
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
# String comparison
if [ "$var" = "value" ]; then

# File check
if [ -f "$file" ]; then

# Command success
if command; then

# Negation
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
# Standard library
import os
import sys
import json
import signal
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import urllib.request
import urllib.error

# No third-party imports (uses stdlib only)
```

### Type Hints
```python
def function(param: str) -> int:
    ...

def optional_param(name: str, value: str | None = None) -> dict[str, Any]:
    ...
```

### Naming Conventions
- Functions/variables: `snake_case` (e.g., `load_config`)
- Classes: `PascalCase` (e.g., `AIDOProxyHandler`)
- Constants: `UPPER_CASE` (e.g., `DEFAULT_PORT`)
- Private functions: `_private_function()`

### Docstrings
```python
def load_config():
    """Load AIDO configuration from config file.
    
    Returns:
        dict: Configuration dictionary with providers and settings.
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
        log(f"Unexpected error: {type(e).__name__}: {e}", "ERROR")
        raise
```

### Logging
- Use the `log()` function defined in server.py
- Log levels: "INFO", "WARN", "ERROR"
- Include request IDs for tracing: `log(f"[{request_id}] message")`

---

## File Structure

```
aido/
├── aido.sh              # Main CLI (944 lines)
├── proxy/
│   ├── __init__.py
│   └── server.py        # Proxy server (594 lines)
├── tests/
│   └── aido_test.sh     # Test suite (188 lines)
├── .gitignore
└── AGENTS.md            # This file
```

---

## Configuration

Config stored in: `~/.aido-data/config.json`

Key settings:
- `model_preference`: "cloud_first", "local_first", or "auto"
- `api_mode`: "chat" or "generate" (default: generate for detailed responses)

---

## Known Issues

1. **DMR Detection**: Error in logs: `'list' object has no attribute 'get'` - needs fix in `detect_providers()`
2. **OpenCode Integration**: Testing proxy with `/api/generate` mode

---

## Key Functions

### Bash (aido.sh)
- `detect_providers()` - Detect available AI providers
- `select_model()` - Auto-select best model for query
- `execute_query()` - Run query against selected model
- `proxy_start/stop/status()` - Manage proxy server

### Python (proxy/server.py)
- `detect_providers()` - Detect running providers
- `select_model()` - Choose model based on preference
- `forward_request()` - Proxy request to backend
- `AIDOProxyHandler` - HTTP request handler

---

## Development Tips

1. **Debug mode**: Use `--debug` flag to see verbose output
2. **Test isolation**: Use `AIDO_TEST_DIR` env var to set test data directory
3. **Proxy logging**: Check `~/.aido-data/logs/proxy.log` for proxy activity
4. **Quick restart**: Stop/start proxy to pick up config changes
