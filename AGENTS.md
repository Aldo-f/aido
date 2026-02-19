# AGENTS.md - AIDO Development Guide

## Overview
AIDO is an intelligent AI CLI with multi-provider support (Ollama, Docker Model Runner, OpenCode Zen, Google Gemini, OpenAI). All API logic is in the FastAPI proxy - the CLI is a thin HTTP wrapper.

---

## Commands

### Running Tests
```bash
make test                    # Run all 44 tests
./tests/aido_test.sh        # Direct run

# Run single test - edit tests/aido_test.sh, comment out unwanted run_test calls
# Or find a test:
./tests/aido_test.sh 2>&1 | grep -E "test_name|✓|✗"
```

### Lint & Format
```bash
make install-tools   # Install ruff, shfmt
make lint            # ruff check, shfmt -d
make format          # ruff format, shfmt -w
make all             # lint + test
```

### Server
```bash
python aido.py serve      # Start proxy (port 11999)
python aido.py serve 8080 # Custom port
python aido.py stop       # Stop proxy
python aido.py status     # Check status
```

---

## Code Style - Python

### General
- Python 3.10+, 100 char line limit, 4-space indent
- Use async/await for FastAPI endpoints

### Imports (order: stdlib -> third-party -> local)
```python
import json
from pathlib import Path
from typing import Any, AsyncGenerator

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

import config
import key_manager
import database
```

### Type Hints
```python
def function(param: str) -> int: ...
def optional_param(name: str, value: str | None = None) -> dict[str, Any]: ...
async def async_function() -> AsyncGenerator[str, None]: ...
```

### Error Handling
- Provider failures: `raise Exception("message")` triggers key rotation
- Use bare `except Exception:` sparingly
- 401/403/429 errors must raise to trigger key rotation

### Logging
- Use `log()` from server.py, Levels: "INFO", "WARN", "ERROR"
- Logs: `~/.aido-data/logs/proxy.log`

### Key Manager
```python
api_key, key_name = key_manager.get_next_key(provider)
key_manager.mark_key_failed(provider, status_code, error_message, retry_after)
key_manager.mark_key_success(provider)
```

---

## Code Style - Bash
- Use `set -euo pipefail` at script top
- Use `[[ ]]` not `[ ]`, use `$(command)` not backticks
- Double-quote all variables: `"$variable"`
- Variables: `lower_case`, Functions: `snake_case`, Constants: `UPPER_CASE`

---

## File Structure
```
aido/
├── Makefile              # lint, format, test
├── aido.py               # Main CLI
├── pyproject.toml        # Version 1.1.1
├── proxy/
│   ├── server.py         # FastAPI (all API logic)
│   ├── config.py         # Config, provider detection
│   ├── key_manager.py    # Key rotation with DB
│   ├── database.py       # SQLite for key failures
│   └── providers/        # zen, gemini, openai, ollama, dmr
└── tests/
    └── aido_test.sh      # 44 tests
```

---

## Configuration
Config: `~/.aido-data/config.json`

```json
{
  "providers": {
    "ollama": {"enabled": true, "endpoint": "http://localhost:11434"},
    "opencode-zen": {"enabled": true, "keys": [{"key": "sk-zen-xxx", "name": "primary"}]},
    "gemini": {"enabled": true, "keys": [{"key": "AIza...", "name": "default"}]},
    "openai": {"enabled": false, "keys": []}
  },
  "selection": {"default_mode": "cloud_first"}
}
```

### Selection Modes
- `cloud_first`: Zen → Gemini → OpenAI → Ollama → DMR
- `local_first`: Ollama → DMR → Zen → Gemini → OpenAI

### Meta Models
- `aido/auto`: Auto-select based on mode
- `aido/cloud`: Cloud providers only
- `aido/local`: Local providers only (Ollama, DMR)

---

## Database
### key_failures Table
| Column | Type | Description |
|--------|------|-------------|
| provider | TEXT | Provider name |
| key_index | INTEGER | Key index in config |
| key_hash | TEXT | SHA256 hash (first 16 chars) |
| status_code | INTEGER | HTTP status (401, 403, 429) |
| available_after | TEXT | ISO timestamp when key is available |

### Cooldowns
- 401/403: 24 hours
- 429: 5 minutes (or custom retry-after)

---

## Tips
1. Always run `aido serve` before queries
2. Debug: `~/.aido-data/logs/proxy.log`
3. Database: `sqlite3 ~/.aido-data/aido.db`
4. Quick restart: `python aido.py stop && python aido.py serve`
5. Test: `curl http://localhost:11999/health`

---

## Request Flow
CLI/OpenCode -> POST /v1/chat/completions
  -> Resolve model (aido/auto/cloud/local)
  -> Select provider based on mode
  -> Get API key with rotation (skip failed keys)
  -> Forward to provider
  -> On success: clear key failure
  -> On 401/403/429: mark key failed, try next
  -> Filter SSE comments if streaming
