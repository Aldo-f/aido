# aido KNOWLEDGE BASE

**Generated:** 2026-03-19
**Commit:** 75af5de
**Branch:** main

## OVERVIEW

Local API key rotation proxy for LLM providers. Automatically rotates keys on rate limits (429). Cooldowns tracked in SQLite.

### Key Features
- **Automatic Key Rotation**: Switches to next available key when rate limited
- **Free Model Discovery**: Automatically discovers and uses free-tier models
- **Multi-Provider Support**: Zen, OpenAI, Anthropic, Groq, Google, Ollama, OpenRouter
- **Model-Specific Rate Limiting**: Tracks rate limits per model, not just per key
- **WAL Mode SQLite**: Concurrent access support for proxy + CLI simultaneously

## STRUCTURE

```
aido/
├── src/               # 20+ TypeScript files, flat structure
│   ├── cli.ts        # Main entry (commander.js CLI)
│   ├── proxy.ts      # HTTP proxy server
│   ├── auto.ts       # Auto-routing logic (forwardAuto, forwardAutoFree)
│   ├── rotator.ts    # Key rotation with model-specific rate limiting
│   ├── detector.ts   # Provider detection
│   ├── db.ts         # SQLite operations (WAL mode enabled)
│   ├── free-discovery.ts  # Free model identification logic
│   └── models/       # Router + parser for model names
├── tests/             # 17 vitest test files at root
│   ├── db.test.ts
│   ├── db-models.test.ts  # NEW: TDD tests for saveModels/getFreeModels
│   └── ...
├── docs/             # Markdown docs
└── aido              # Bash wrapper (runs cli.ts via tsx)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add key | `src/rotator.ts` | Key management, loadKeysForProvider() |
| Model routing | `src/models/router.ts` | routeAidoModel() |
| Proxy server | `src/proxy.ts` | HTTP handling, enrichModelsWithCapabilities() |
| Free Model Discovery | `src/free-discovery.ts` | identifyFreeModels(), discoverFreeModels() |
| Key Rotation | `src/rotator.ts` | KeyRotator with model-specific rate limiting |
| Config | `src/launch.ts` | OpenCode integration |
| Hunt daemon | `src/hunt.ts` | Gitleaks scanning |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| cli.ts | CLI | src/cli.ts | Commands: add, run (with --auto-free), models, proxy, launch, status, clear, stop, hunt |
| rotator.ts | Module | src/rotator.ts | Key loading, rotation, cooldowns, model-specific rate limiting |
| router.ts | Module | src/models/router.ts | Parses aido/zen/big-pickle → provider |
| proxy.ts | Module | src/proxy.ts | HTTP server, forwards requests |
| auto.ts | Module | src/auto.ts | forwardAuto(), forwardAutoFree() for cross-provider free model discovery |
| free-discovery.ts | Module | src/free-discovery.ts | identifyFreeModels(), discoverFreeModels() |
| db.ts | Module | src/db.ts | SQLite operations (WAL mode), saveModels(), getFreeModels() |
| mergeWithCapabilities | Func | src/model-capabilities.ts | Adds context/allows to model responses |

## CONVENTIONS (THIS PROJECT)

- **No build step** - runs via tsx directly from src/
- **ESM** - `"type": "module"` in package.json
- **SQLite** - Node.js built-in (`--experimental-sqlite`)
- **Testing** - vitest, tests at project root
- **CLI** - commander.js, bash wrapper in root

## ANTI-PATTERNS (THIS PROJECT)

- NEVER use `as any` - strict TypeScript
- NEVER commit secrets - .env is gitignored
- NEVER skip tests - 162 tests must pass

## UNIQUE STYLES

- Model IDs duplicated in /v1/models response (original + prefixed) for OpenCode validation
- Provider detection via `owned_by` field from upstream API
- Auto mode falls through on 429 to next provider
- All models saved to DB with `isFree` flag (1 for free, 0 for paid)

## COMMANDS

```bash
npm test                    # Run tests (162)
npm run proxy               # Start proxy
./aido add <key>           # Add API key
./aido run "test" --auto-free  # Use free models first
./aido launch --target opencode  # Configure OpenCode
./aido hunt                # Start hunt daemon
```

## DATABASE SCHEMA

### Models Table (renamed from `free_models`)
```sql
CREATE TABLE models (
  provider      TEXT    NOT NULL,
  model_id      TEXT    NOT NULL,
  model_name    TEXT    NOT NULL,
  isFree        INTEGER NOT NULL DEFAULT 0,  -- 1 = free, 0 = paid
  discovered_at INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  PRIMARY KEY (provider, model_id)
);
```

### Model Limits Table (NEW)
```sql
CREATE TABLE model_limits (
  provider      TEXT    NOT NULL,
  model_id      TEXT    NOT NULL,
  limited_until INTEGER NOT NULL,
  PRIMARY KEY (provider, model_id)
);
```

## NOTES

- Node.js v22+ required (SQLite built-in)
- Port default: 4141
- Model format: `aido/zen/big-pickle`, `aido/auto`, `aido/local`
- SQLite WAL mode enabled for concurrent proxy + CLI access
- Free models cached in DB with 1-hour TTL
