# Gebruik

AIDO biedt een eenvoudige command-line interface voor het communiceren met AI modellen.

---

## Basis Gebruik

```bash
# Query met streaming (standaard)
aido run "Hallo, hoe gaat het?"

# Query zonder streaming
aido run --no-stream "Hallo"

# Interactieve modus
aido run
```

---

## Proxy Starten

Voordat je queries kunt uitvoeren, moet je de proxy starten:

```bash
# Start proxy (standaard poort 11999)
aido serve

# Start op aangepaste poort
aido serve 8080

# Stop de proxy
aido stop

# Check status
aido status
```

---

## Interactieve Modus

```bash
# Start interactieve modus
aido run

# Commando's in interactieve modus
> Hallo                    # Verzend een query
> /help                    # Toon hulp
> /models                  # Lijst beschikbare modellen
> /status                  # Toon proxy status
> /exit                    # Afsluiten
```

---

## Model Selectie

AIDO ondersteunt verschillende meta-modellen:

| Model | Beschrijving |
|-------|--------------|
| `aido/auto` | Auto-selecteer op basis van configuratie |
| `aido/cloud` | Gebruik alleen cloud providers |
| `aido/local` | Gebruik alleen lokale providers |

```bash
# Gebruik specifiek model
aido run -m aido/local "Hallo"
```

---

## Voorbeelden

```bash
# Basis query
aido run "Hoe keer ik een lijst om in Python?"

# Hulp bij een coding probleem
aido run "Leg async/await uit in Python"

# Ga door een gesprek (interactieve modus)
aido run

# Lijst beschikbare modellen
aido list

# Check provider status
aido status
```
