# AGENTS.md - AIDO Development Guide

## Overview

AIDO is an intelligent AI CLI assistant with multi-provider support (Ollama, Docker Model Runner, OpenCode Zen, Google Gemini, OpenAI). The proxy server is built with FastAPI for optimal performance.

---

## Development Setup

### Pre-Commit Hook

AIDO uses a pre-commit hook that automatically runs all tests before allowing a commit:

```bash
# The hook is located at:
.git/hooks/pre-commit

# Tests run automatically when you commit:
git commit -m "your message"

# If tests fail, the commit is aborted
```

To manually install the hook:
```bash
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
echo "Running tests before commit..."
cd /media/aldo/shared/aido
if ! timeout 120 make test > /tmp/pre-commit-test.log 2>&1; then
    echo "❌ TESTS FAILED - Commit aborted"
    tail -50 /tmp/pre-commit-test.log
    exit 1
fi
echo "✅ All tests passed!"
exit 0
EOF
chmod +x .git/hooks/pre-commit
```

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

# Or directly with uvicorn:
python3 -m uvicorn proxy.server:app --host 0.0.0.0 --port 11999
```

### Query Commands

```bash
./aido.sh run "Hello"    # Run query
./aido.sh run            # Interactive mode
./aido.sh run -c         # Continue last session
./aido.sh list           # List available models
./aido.sh pull llama3.2  # Download model
```

### Manual API Testing

```bash
# Health check
curl http://localhost:11999/health

# List models
curl http://localhost:11999/v1/models

# Chat completion
curl -X POST http://localhost:11999/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "aido/auto", "messages": [{"role": "user", "content": "Hello"}]}'
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
- Python 3.10+ (modern type hints: `dict[str, Any]`, `list[str]`)
- 100 character line limit, 4-space indent
- Use async/await for FastAPI endpoints

### Imports
```python
# Order: stdlib -> third-party -> local
import json
import os
import sys
from pathlib import Path
from typing import Any, AsyncGenerator

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

import config
import key_manager
```

### Type Hints
```python
def function(param: str) -> int:
    ...

def optional_param(name: str, value: str | None = None) -> dict[str, Any]:
    ...

async def async_function() -> AsyncGenerator[str, None]:
    ...
```

### Naming
- Functions/variables: `snake_case`
- Classes: `PascalCase`
- Constants: `UPPER_CASE`
- Private: `_private_function()`

### Error Handling
```python
try:
    resp = await client.post(url, json=body, headers=headers)
    if resp.status_code in (401, 403, 429):
        key_manager.mark_key_failed(provider, resp.status_code)
        continue
except httpx.HTTPError as e:
    log(f"Request failed: {e}")
    return JSONResponse({"error": str(e)}, status_code=500)
```

### Logging
- Use `log()` function from server.py
- Levels: "INFO", "WARN", "ERROR"
- Logs written to `~/.aido-data/logs/proxy.log`

---

## File Structure

```
aido/
├── Makefile              # Build/lint/format commands
├── aido.sh               # Main CLI
├── requirements.txt      # Python dependencies (FastAPI, uvicorn, httpx)
├── proxy/
│   ├── __init__.py       # Module exports
│   ├── config.py         # Config loading, provider detection
│   ├── key_manager.py    # Multi-key rotation with failure tracking
│   ├── database.py       # SQLite for query tracking
│   ├── server.py         # FastAPI main application
│   └── providers/
│       ├── __init__.py
│       ├── base.py       # Base provider class
│       ├── zen.py        # OpenCode Zen provider
│       ├── gemini.py     # Google Gemini provider
│       ├── openai.py     # OpenAI provider
│       ├── ollama.py     # Ollama (local) provider
│       └── dmr.py        # Docker Model Runner provider
├── tests/
│   ├── aido_test.sh
│   └── aido_opencode_test.py
└── AGENTS.md             # This file
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

### Meta Models

| Model | Behavior |
|-------|----------|
| `aido/auto` | Auto-select based on selection mode |
| `aido/cloud` | Only use cloud providers |
| `aido/local` | Only use local providers |

### Provider Config
```json
{
  "providers": {
    "ollama": {"enabled": true, "endpoint": "http://localhost:11434"},
    "opencode-zen": {
      "enabled": true,
      "keys": [
        {"key": "sk-zen-xxx", "name": "primary"},
        {"key": "sk-zen-yyy", "name": "backup"}
      ]
    },
    "gemini": {"enabled": true, "keys": [{"key": "AIza...", "name": "default"}]},
    "openai": {"enabled": true, "keys": [{"key": "sk-...", "name": "default"}]}
  },
  "selection": {"default_mode": "cloud_first"}
}
```

### Multi-Key Support
- Keys tried sequentially
- On HTTP 401/403/429, skip to next key
- All keys exhausted → try next provider

---

## Provider Fallback Order

### Cloud First (default)
1. OpenCode Zen → 2. Gemini → 3. OpenAI → 4. Ollama → 5. Docker Model Runner

### Local First
1. Ollama → 2. Docker Model Runner → 3. OpenCode Zen → 4. Gemini → 5. OpenAI

---

## Development Tips

1. **Debug**: Check `~/.aido-data/logs/proxy.log`
2. **Test isolation**: Use `AIDO_TEST_DIR` env var
3. **Quick restart**: `./aido.sh stop && ./aido.sh serve`
4. **Key rotation**: Server resets key state on restart
5. **Provider status**: `curl localhost:11999/health`

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check + provider status |
| `/v1/models` | GET | List all available models |
| `/v1/chat/completions` | POST | OpenAI-compatible chat |
| `/chat/completions` | POST | Same as above (without /v1) |

### Request Flow

```
OpenCode -> AIDO Proxy (port 11999)
              |
              v
    [Resolve model: aido/auto, aido/cloud, specific model]
              |
              v
    [Select provider based on mode]
              |
              v
    [Get API key with rotation]
              |
              v
    [Forward request to provider]
              |
              v
    [Filter SSE comments if streaming]
              |
              <-- Return response to OpenCode
```
