# AIDO - Intelligent AI CLI

A unified AI CLI that intelligently routes queries across multiple providers.

![Python](https://img.shields.io/badge/python-3.10+-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

- **Multi-Provider Support**: Ollama, Docker Model Runner, OpenCode Zen, Google Gemini, OpenAI
- **Intelligent Routing**: Automatically selects the best model for your query
- **OpenAI-Compatible Proxy**: Works with OpenCode and other OpenAI-compatible clients
- **Streaming Support**: See responses as they're generated

---

## Quick Start

```bash
# Install AIDO
pipx install git+https://github.com/aldo-f/aido.git

# Start the proxy
aido serve

# Query using AIDO (streaming enabled by default)
aido run "Hello, help me write a function"
```

---

## Links

- [Installation](installation.md)
- [Usage](usage.md)
- [Commands](commands.md)
- [Configuration](configuration.md)
- [GitHub](https://github.com/aldo-f/aido)
- [Report Issues](https://github.com/aldo-f/aido/issues)
