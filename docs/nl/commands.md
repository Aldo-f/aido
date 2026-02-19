# Commando's

Complete referentie voor alle AIDO commando's.

---

## Server Commando's

| Commando | Beschrijving |
|----------|--------------|
| `aido serve [poort]` | Start proxy server (standaard: 11999) |
| `aido stop` | Stop proxy server |
| `aido status` | Toon proxy en provider status |

---

## Query Commando's

| Commando | Beschrijving |
|----------|--------------|
| `aido run [query]` | Voer een query uit |
| `aido run` | Start interactieve modus |
| `aido run --no-stream` | Voer uit zonder streaming |

---

## Model Commando's

| Commando | Beschrijving |
|----------|--------------|
| `aido list` | Lijst beschikbare modellen |
| `aido providers` | Lijst geconfigureerde providers |
| `aido pull [model]` | Download een model (Ollama) |

---

## Configuratie Commando's

| Commando | Beschrijving |
|----------|--------------|
| `aido init` | Check alle providers en configuratie |
| `aido connect opencode` | Configureer OpenCode om AIDO te gebruiken |
| `aido auth [provider]` | Open auth pagina voor provider |

---

## Key Management

| Commando | Beschrijving |
|----------|--------------|
| `aido key list` | Lijst alle API keys |
| `aido key add <provider> <key> [naam]` | Voeg API key toe |
| `aido key delete <provider> <index>` | Verwijder API key |
| `aido key delete-all <provider>` | Verwijder alle keys voor provider |

### Voorbeelden

```bash
# Lijst keys
aido key list

# Voeg key toe
aido key add opencode-zen sk-zen-xxx "mijn-key"

# Verwijder key
aido key delete opencode-zen 0
```

---

## Sessie Management

| Commando | Beschrijving |
|----------|--------------|
| `aido session list` | Lijst alle sessies |
| `aido session new [naam]` | Maak nieuwe sessie |
| `aido session delete [naam]` | Verwijder een sessie |

---

## Help

```bash
# Toon algemene help
aido --help

# Toon commando-specifieke help
aido serve --help
aido run --help
aido key --help
```
