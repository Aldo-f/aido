# AIDO - Intelligente AI CLI

Een uniforme AI CLI die queries intelligent doorstuurt naar meerdere providers.

![Python](https://img.shields.io/badge/python-3.10+-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Kenmerken

- **Multi-Provider Ondersteuning**: Ollama, Docker Model Runner, OpenCode Zen, Google Gemini, OpenAI
- **Intelligente Routering**: Kiest automatisch het beste model voor je query
- **OpenAI-Compatible Proxy**: Werkt met OpenCode en andere OpenAI-compatible clients
- **Streaming Ondersteuning**: Zie antwoorden terwijl ze worden gegenereerd

---

## Snel Starten

```bash
# Installeer AIDO
pipx install git+https://github.com/aldo-f/aido.git

# Start de proxy
aido serve

# Query AIDO (streaming standaard ingeschakeld)
aido run "Hallo, help me een functie te schrijven"
```

---

## Links

- [Installatie](installation.md)
- [Gebruik](usage.md)
- [Commando's](commands.md)
- [Configuratie](configuration.md)
- [GitHub](https://github.com/aldo-f/aido)
- [Problemen melden](https://github.com/aldo-f/aido/issues)
