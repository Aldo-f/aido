# aido KNOWLEDGE BASE

**Generated:** 2026-03-17
**Commit:** 0954842
**Branch:** main

## OVERVIEW

Local API key rotation proxy for LLM providers. Automatically rotates keys on rate limits (429). Cooldowns tracked in SQLite.

## STRUCTURE

```
aido/
├── src/               # 18 TypeScript files, flat structure
│   ├── cli.ts        # Main entry (commander.js CLI)
│   ├── proxy.ts      # HTTP proxy server
│   ├── auto.ts       # Auto-routing logic
│   ├── rotator.ts    # Key rotation
│   ├── detector.ts   # Provider detection
│   ├── db.ts         # SQLite operations
│   └── models/       # Router + parser for model names
├── tests/             # 15 vitest test files at root
├── docs/             # Markdown docs
└── aido              # Bash wrapper (runs cli.ts via tsx)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add key | `src/rotator.ts` | Key management, loadKeysForProvider() |
| Model routing | `src/models/router.ts` | routeAidoModel() |
| Proxy server | `src/proxy.ts` | HTTP handling, enrichModelsWithCapabilities() |
| Config | `src/launch.ts` | OpenCode integration |
| Hunt daemon | `src/hunt.ts` | Gitleaks scanning |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| cli.ts | CLI | src/cli.ts | 11 commands: add, run, models, proxy, launch, status, clear, stop, hunt |
| rotator.ts | Module | src/rotator.ts | Key loading, rotation, cooldowns |
| router.ts | Module | src/models/router.ts | Parses aido/zen/big-pickle → provider |
| proxy.ts | Module | src/proxy.ts | HTTP server, forwards requests |
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
- NEVER skip tests - 145 tests must pass

## UNIQUE STYLES

- Model IDs duplicated in /v1/models response (original + prefixed) for OpenCode validation
- Provider detection via `owned_by` field from upstream API
- Auto mode falls through on 429 to next provider

## COMMANDS

```bash
npm test                    # Run tests (145)
npm run proxy               # Start proxy
./aido add <key>           # Add API key
./aido launch --target opencode  # Configure OpenCode
./aido hunt                # Start hunt daemon
```

## NOTES

- Node.js v22+ required (SQLite built-in)
- Port default: 4141
- Model format: `aido/zen/big-pickle`, `aido/auto`, `aido/local`
