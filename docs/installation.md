# Installation

AIDO can be installed in several ways. Choose the one that best fits your needs.

---

## Option 1: pipx (Recommended)

```bash
# Install pipx if you don't have it
pipx install git+https://github.com/aldo-f/aido.git

# Verify installation
aido --version
```

---

## Option 2: pip install (Editable)

```bash
# Clone the repository
git clone https://github.com/aldo-f/aido.git
cd aido

# Install dependencies
pip install -r requirements.txt

# Install in editable mode
pip install -e .
```

---

## Option 3: Download Binary

Download pre-built binaries from [Releases](https://github.com/aldo-f/aido/releases):

```bash
# Linux/macOS
chmod +x aido
sudo mv aido /usr/local/bin/

# Windows: Add aido.exe to PATH
```

---

## Option 4: From Source (Development)

```bash
# Clone the repository
git clone https://github.com/aldo-f/aido.git
cd aido

# Install dependencies
pip install -r requirements.txt

# Run directly
python aido.py serve
```

---

## Requirements

| Requirement | Description |
|-------------|-------------|
| Python 3.10+ | Required for async/await support |
| Running proxy | Ollama or cloud API keys |

### Ollama (Local)

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull llama3.2
```

### Cloud Providers

For cloud providers (Zen, Gemini, OpenAI), you'll need API keys. Use:

```bash
aido auth zen      # OpenCode Zen
aido auth gemini   # Google Gemini
aido auth openai   # OpenAI
```
