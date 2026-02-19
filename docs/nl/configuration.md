# Configuratie

Pas AIDO gedrag aan via configuratie bestanden en omgevingsvariabelen.

---

## Configuratie Bestand

Het configuratie bestand wordt opgeslagen op: `~/.aido-data/config.json`

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

## Selectie Modi

| Modus | Gedrag |
|------|--------|
| `cloud_first` | Geef voorkeur aan cloud providers (Zen, Gemini, OpenAI), fallback naar lokaal |
| `local_first` | Geef voorkeur aan lokale providers (Ollama, DMR), fallback naar cloud |

---

## Providers

### Lokale Providers

| Provider | Beschrijving | Vereist Key |
|----------|--------------|-------------|
| ollama | Lokale Ollama instantie | Nee |
| docker-model-runner | Docker Model Runner | Nee |

### Cloud Providers

| Provider | Beschrijving | Vereist Key |
|----------|--------------|-------------|
| opencode-zen | OpenCode Zen modellen | Ja |
| gemini | Google Gemini | Ja |
| openai | OpenAI GPT modellen | Ja |

---

## Omgevingsvariabelen

| Variabele | Beschrijving | Standaard |
|------------|--------------|-----------|
| `OLLAMA_ENDPOINT` | Ollama server URL | http://localhost:11434 |
| `DMR_ENDPOINT` | Docker Model Runner URL | http://localhost:12434 |

---

## OpenCode Integratie

Om AIDO te gebruiken met OpenCode:

```bash
# Configureer OpenCode
aido connect opencode

# Herstart OpenCode
```

Dit maakt een configuratie aan op `~/.config/opencode/opencode.jsonc` die AIDO beschikbaar maakt in OpenCode.
