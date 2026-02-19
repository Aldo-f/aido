# Installatie

AIDO kan op verschillende manieren worden geïnstalleerd. Kies de optie die het beste bij je past.

---

## Optie 1: pipx (Aanbevolen)

```bash
# Installeer pipx als je het niet hebt
pipx install git+https://github.com/aldo-f/aido.git

# Verifieer installatie
aido --version
```

---

## Optie 2: pip install (Editable)

```bash
# Clone de repository
git clone https://github.com/aldo-f/aido.git
cd aido

# Installeer dependencies
pip install -r requirements.txt

# Installeer in editable mode
pip install -e .
```

---

## Optie 3: Download Binary

Download voorgebouwde binaries van [Releases](https://github.com/aldo-f/aido/releases):

```bash
# Linux/macOS
chmod +x aido
sudo mv aido /usr/local/bin/

# Windows: Voeg aido.exe toe aan PATH
```

---

## Optie 4: Van Source (Ontwikkeling)

```bash
# Clone de repository
git clone https://github.com/aldo-f/aido.git
cd aido

# Installeer dependencies
pip install -r requirements.txt

# Run direct
python aido.py serve
```

---

## Vereisten

| Vereiste | Beschrijving |
|----------|--------------|
| Python 3.10+ | Nodig voor async/await ondersteuning |
| Draaiende proxy | Ollama of cloud API keys |

### Ollama (Lokaal)

```bash
# Installeer Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Download een model
ollama pull llama3.2
```

### Cloud Providers

Voor cloud providers (Zen, Gemini, OpenAI) heb je API keys nodig. Gebruik:

```bash
aido auth zen      # OpenCode Zen
aido auth gemini   # Google Gemini
aido auth openai   # OpenAI
```
