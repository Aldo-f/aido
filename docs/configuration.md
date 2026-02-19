# Configuration

Customize AIDO behavior through configuration files and environment variables.

---

## Configuration File

The configuration file is stored at: `~/.aido-data/config.json`

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
        {"key": "sk-zen-xxx", "name": "primary"}
      ]
    },
    "gemini": {
      "enabled": true,
      "keys": [
        {"key": "AIzaSy...", "name": "default"}
      ]
    }
  },
  "selection": {
    "default_mode": "cloud_first"
  }
}
```

---

## Selection Modes

| Mode | Behavior |
|------|----------|
| `cloud_first` | Prefer cloud providers (Zen, Gemini, OpenAI), fallback to local |
| `local_first` | Prefer local providers (Ollama, DMR), fallback to cloud |

---

## Providers

### Local Providers

| Provider | Description | Requires Key |
|----------|-------------|--------------|
| ollama | Local Ollama instance | No |
| docker-model-runner | Docker Model Runner | No |

### Cloud Providers

| Provider | Description | Requires Key |
|----------|-------------|--------------|
| opencode-zen | OpenCode Zen models | Yes |
| gemini | Google Gemini | Yes |
| openai | OpenAI GPT models | Yes |

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OLLAMA_ENDPOINT` | Ollama server URL | http://localhost:11434 |
| `DMR_ENDPOINT` | Docker Model Runner URL | http://localhost:12434 |

---

## OpenCode Integration

To use AIDO with OpenCode:

```bash
# Configure OpenCode
aido connect opencode

# Restart OpenCode
```

This creates a configuration at `~/.config/opencode/opencode.jsonc` that makes AIDO available in OpenCode.
