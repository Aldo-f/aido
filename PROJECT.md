# AIdo Project Architecture

**Purpose**: Local API key rotation proxy for LLM providers with automatic free model discovery.

---

## 1. PROJECT STRUCTURE OVERVIEW

```
aido/
├── src/
│   ├── cli.ts              # Entry point - parses commands and routes to handlers
│   ├── run.ts              # Direct CLI execution (aido run command)
│   ├── proxy.ts            # HTTP proxy server (aido proxy command)
│   ├── auto.ts             # Auto-routing logic (forwardAuto, forwardAutoFree)
│   ├── rotator.ts          # Key rotation with model-specific rate limiting
│   ├── db.ts               # SQLite database operations (WAL mode)
│   ├── free-discovery.ts   # Free model identification logic
│   ├── detector.ts         # Provider detection from key format
│   └── models/             # Model name parsing and routing
├── tests/                  # 17 vitest test files
└── aido                    # Bash wrapper (runs cli.ts via tsx)
```

---

## 2. TWO WAYS TO USE AIDO

### 2.1 Direct CLI Execution (`aido run`)

**Flow**: `CLI → run() → API call → Response`

```
User runs: aido run -m aido/zen/big-pickle "Hello"

1. cli.ts parses arguments
   ├─ provider = 'zen' (from model name)
   ├─ model = 'big-pickle'
   └─ prompt = "Hello"

2. run() function executes:
   ├─ Gets free models from DB for 'zen' provider
   ├─ If model specified (-m flag), uses THAT model
   ├─ If no model, uses first free model OR DEFAULT_MODELS[provider]
   ├─ Gets next available key from rotator
   ├─ Makes direct API call to provider
   └─ Returns response

Key Points:
- Runs ONCE per command
- Uses provider-specific key
- Model selection is EXPLICIT when -m is used
```

**⚠️ CRITICAL LOGIC CHECK**:
```typescript
// In src/run.ts line 68-69:
const freeModels = getFreeModels(provider);
const selectedModel = model ?? (freeModels.length > 0 ? freeModels[0].id : DEFAULT_MODELS[provider]);

// If user specifies -m aido/zen/minimax-m2.5-free:
// model = "minimax-m2.5-free" (from model name parsing)
// selectedModel = "minimax-m2.5-free" (NOT from freeModels array)
```

**This is CORRECT** - the `-m` flag overrides the free model selection.

---

### 2.2 HTTP Proxy Server (`aido proxy`)

**Flow**: `Client → Proxy → Router → Auto-routing → API → Response`

```
User runs: aido proxy
Server starts on http://localhost:4141

Client sends: POST http://localhost:4141/v1/chat/completions
Body: {"model": "aido/zen/big-pickle", "messages": [...]}

1. proxy.ts receives request
   ├─ Parses model name from request body
   ├─ Routes to appropriate handler based on URL path

2. Router (src/models/router.ts) parses model name:
   ├─ "aido/zen/big-pickle" → provider='zen', model='big-pickle'
   ├─ "aido/auto" → provider='auto', model='auto'
   ├─ "aido/cloud" → provider='zen', model='auto' (cloud priority)
   └─ "aido/local" → provider='ollama-local', model='auto'

3. Auto-routing (src/auto.ts):
   ├─ forwardAuto() for provider-specific routing
   ├─ forwardAutoFree() for cross-provider free model discovery
   └─ Returns response

Key Points:
- Runs continuously as HTTP server
- Intercepts ALL requests to /v1/chat/completions
- Model selection comes from REQUEST BODY, not command line
```

---

## 3. KEY DIFFERENCES: aido run vs proxy

| Feature | `aido run` | `aido proxy` |
|---------|------------|--------------|
| **Execution** | One-time CLI command | Continuous HTTP server |
| **Model Selection** | From `-m` flag or auto-discovery | From request body JSON |
| **Use Case** | Quick testing, scripts | Applications (Claude Code, OpenCode) |
| **Port** | N/A (direct API call) | 4141 (default) |
| **Routing** | Simple: one provider, one model | Complex: can route to any provider |
| **Free Models** | Uses DB to find free models | Uses DB to find free models |

---

## 4. FREE MODEL DISCOVERY ARCHITECTURE

### 4.1 Model Storage (Database Schema)

**Table: `models`** (renamed from `free_models`)
```sql
provider      TEXT    NOT NULL    -- 'zen', 'openai', etc.
model_id      TEXT    NOT NULL    -- 'big-pickle', 'gpt-4o'
model_name    TEXT    NOT NULL    -- Display name
isFree        INTEGER NOT NULL    -- 1 = free, 0 = paid
discovered_at INTEGER NOT NULL    -- Timestamp
expires_at    INTEGER NOT NULL    -- Cache expiration
PRIMARY KEY (provider, model_id)
```

**Key Insight**: ALL models are saved, but `isFree` flag determines which are free.

### 4.2 Identification Logic (src/free-discovery.ts)

```typescript
function identifyFreeModels(provider: string, models: RawModel[]): FreeModel[] {
  switch (provider) {
    case 'zen':
      // Free if ends with '-free' OR is 'big-pickle'
      return models.map(m => ({
        ...m,
        isFree: m.id.endsWith('-free') || m.id === 'big-pickle'
      }));
    case 'openrouter':
      // Free if ends with ':free'
      return models.map(m => ({
        ...m,
        isFree: m.id.endsWith(':free')
      }));
    case 'google':
      // Some models are free (gemini-1.5-flash, gemini-exp-1206)
      return models.map(m => ({
        ...m,
        isFree: isGoogleFreeModel(m.id)
      }));
    default:
      // Other providers: no free models by default
      return models.map(m => ({ ...m, isFree: false }));
  }
}
```

### 4.3 Data Flow

```
1. DISCOVERY (when models are fetched from provider API)
   ├─ fetchModels() calls provider API
   ├─ identifyFreeModels() tags each model with isFree flag
   └─ saveModels() stores ALL models to DB with isFree value

2. RETRIEVAL (when selecting a model to use)
   ├─ getFreeModels(provider) queries:
   │   SELECT * FROM models WHERE provider=? AND isFree=1
   └─ Returns only models where isFree = 1

3. USAGE (in run.ts or auto.ts)
   ├─ If model specified (-m flag): use it regardless of isFree
   └─ If no model: use first free model or DEFAULT_MODELS
```

---

## 5. KEY ROTATION ARCHITECTURE

### 5.1 Database Schema

**Table: `rate_limits`** (per-key rate limiting)
```sql
key           TEXT    NOT NULL    -- API key
provider      TEXT    NOT NULL
limited_until INTEGER NOT NULL    -- When key becomes available
hit_count     INTEGER DEFAULT 0   -- How many times rate limited
PRIMARY KEY (key, provider)
```

**Table: `model_limits`** (per-model rate limiting) - NEW
```sql
provider      TEXT    NOT NULL
model_id      TEXT    NOT NULL
limited_until INTEGER NOT NULL    -- When model becomes available
PRIMARY KEY (provider, model_id)
```

### 5.2 KeyRotator Class (src/rotator.ts)

```typescript
class KeyRotator {
  private keys: string[];        // All keys for provider
  private models: string[] = []; // Optional: specific models to try
  private keyIndex = 0;          // Current key index
  private modelIndex = 0;        // Current model index (if models specified)

  next(): string | null {
    // Returns next available (non-rate-limited) key
    // Loops through all keys until finding one not in rate_limits table
  }

  getNextModel(): { key: string; model: string } | null {
    // If models specified: tries combinations of key + model
    // Checks both rate_limits (per-key) and model_limits (per-model)
  }
}
```

### 5.3 Rotation Flow

```
When making API request:

1. Get rotator for provider
   rotator = getRotator('zen')

2. Get next available key
   key = rotator.next()

3. If 429 response:
   ├─ Mark key as rate-limited in rate_limits table
   ├─ Mark model as rate-limited in model_limits table (if applicable)
   ├─ Try next key
   └─ If all keys exhausted: return 503 to client

4. After cooldown (default 1 hour):
   ├─ Key becomes available again
   └─ Model becomes available again
```

---

## 6. REQUEST FLOWS DETAILED

### 6.1 Flow: `aido run -m aido/zen/minimax-m2.5-free "Hello"`

```
CLI Input:
  command: run
  model: aido/zen/minimax-m2.5-free
  prompt: "Hello"

Processing in cli.ts:
  1. Parse model name: "aido/zen/minimax-m2.5-free"
     ├─ provider = 'zen' (from path)
     └─ model = 'minimax-m2.5-free' (from path)

  2. Call run(prompt, { provider: 'zen', model: 'minimax-m2.5-free' })

Processing in run.ts:
  1. Get free models for 'zen' provider
     freeModels = getFreeModels('zen')
     // Returns array of models where isFree=1

  2. Select model
     selectedModel = model ?? (freeModels[0]?.id ?? DEFAULT_MODELS['zen'])
     // Since model IS specified: selectedModel = 'minimax-m2.5-free'
     // NOT from freeModels array!

  3. Get API key
     key = rotator.next()  // Gets next available key for zen

  4. Make API call
     POST https://opencode.ai/zen/v1/chat/completions
     Body: {"model": "minimax-m2.5-free", "messages": [...]}

  5. Return response to user
```

**✅ THIS IS CORRECT** - The model from -m flag is used directly.

---

### 6.2 Flow: `aido run "Hello"` (no -m flag)

```
CLI Input:
  command: run
  model: undefined
  prompt: "Hello"

Processing in cli.ts:
  1. No model specified
  2. provider defaults to 'auto'

Processing in run.ts:
  1. Provider is 'auto'
     // This triggers auto-routing path in run()

  2. If provider === 'auto':
     ├─ routeAidoModel('auto') returns route
     ├─ forwardAuto() is called
     └─ This tries multiple providers, not just one

  3. If provider is specific (e.g., 'zen'):
     freeModels = getFreeModels('zen')
     selectedModel = freeModels[0]?.id ?? DEFAULT_MODELS['zen']
     // Uses first free model OR default
```

**⚠️ WATCH OUT**: If you specify `-p zen` without `-m`, it will use the first free model.

---

### 6.3 Flow: HTTP Proxy Request

```
Client sends:
  POST http://localhost:4141/v1/chat/completions
  Body: {"model": "aido/zen/minimax-m2.5-free", "messages": [...]}

Processing in proxy.ts:
  1. Receive request
  2. Parse body JSON
  3. Extract model name: "aido/zen/minimax-m2.5-free"

Processing in router.ts:
  parseAidoModel("aido/zen/minimax-m2.5-free")
  Returns: { provider: 'zen', model: 'minimax-m2.5-free', priorityType: 'auto' }

Processing in auto.ts (forwardAuto):
  1. rotator = getRotator('zen')
  2. key = rotator.next()
  3. Make API call with model='minimax-m2.5-free'
  4. Return response
```

**Key Difference**: Model comes from HTTP request body, not command line.

---

## 7. POTENTIAL LOGIC MISTAKES TO WATCH FOR

### 7.1 Model Selection Mistakes

| Scenario | Expected Behavior | Potential Bug |
|----------|-------------------|---------------|
| `aido run -m aido/zen/model "hi"` | Uses `model` directly | ❌ If code uses freeModels[0] instead |
| `aido run -p zen -m model "hi"` | Uses `model` directly | ❌ Same issue |
| `aido run -p zen "hi"` | Uses first free model | ✅ Correct |
| `aido run "hi"` | Uses auto-routing | ✅ Correct (triggers forwardAuto) |

**Check in src/run.ts line 68-69**:
```typescript
const selectedModel = model ?? (freeModels.length > 0 ? freeModels[0].id : DEFAULT_MODELS[provider]);
```
✅ `??` operator means: use `model` if it exists, otherwise use freeModels[0]

### 7.2 Provider Detection Mistakes

| Model Name | Expected Provider | Potential Bug |
|------------|-------------------|---------------|
| `aido/zen/big-pickle` | zen | ❌ If router doesn't parse correctly |
| `aido/auto` | auto (triggers forwardAuto) | ❌ If treated as specific provider |
| `big-pickle` (no prefix) | Depends on context | ❌ Ambiguous |

**Check in src/models/router.ts**:
```typescript
export function parseAidoModel(path: string): ParsedAidoModel {
  // Should handle: "aido/zen/big-pickle", "aido/auto", "big-pickle"
}
```

### 7.3 Free Model Discovery Mistakes

| Scenario | Expected | Potential Bug |
|----------|----------|---------------|
| Zen model ends with `-free` | isFree = true | ❌ If regex doesn't match |
| Zen model is `big-pickle` | isFree = true | ❌ If special case not handled |
| OpenRouter model ends with `:free` | isFree = true | ❌ If regex doesn't match |
| Google model is `gemini-1.5-flash` | isFree = true | ❌ If not in free list |

**Check in src/free-discovery.ts**:
```typescript
case 'zen':
  return m.id.endsWith('-free') || m.id === 'big-pickle';
case 'openrouter':
  return m.id.endsWith(':free');
```

### 7.4 Rate Limiting Mistakes

| Scenario | Expected | Potential Bug |
|----------|----------|---------------|
| Key gets 429 response | Key marked in rate_limits | ❌ If not marked |
| Model gets 429 response | Model marked in model_limits | ❌ If not marked |
| After 1 hour cooldown | Key/model available again | ❌ If cleanup doesn't run |

**Check in src/db.ts**:
```typescript
export function markRateLimited(key: string, provider: string, cooldownSeconds: number)
export function markModelRateLimited(provider: string, modelId: string, cooldownSeconds: number)
```

---

## 8. COMMAND REFERENCE

### 8.1 CLI Commands

```bash
# Direct execution (one-time)
aido run "Hello"                    # Auto-route to best provider
aido run -m aido/zen/big-pickle "Hello"  # Specific model
aido run -p zen "Hello"             # Specific provider, auto-select model
aido run --auto-free "Hello"        # Try free models across all providers

# Proxy server (continuous)
aido proxy                          # Start proxy on port 4141
aido stop                           # Stop proxy

# Model management
aido models                         # List all models (cached 1 hour)
aido models zen                     # List models for specific provider
aido models --sync                  # Force refresh cache

# Key management
aido add sk-zen-key...              # Add API key
aido status                         # Show configured providers & rate limits
aido clear                          # Clear all rate limits

# Hunt daemon
aido hunt                           # Search for leaked keys
aido hunt:stop                      # Stop hunt daemon
```

### 8.2 Model Name Formats

| Format | Provider | Example |
|--------|----------|---------|
| `aido/zen/<model>` | Zen | `aido/zen/big-pickle` |
| `aido/openai/<model>` | OpenAI | `aido/openai/gpt-4o-mini` |
| `aido/anthropic/<model>` | Anthropic | `aido/anthropic/claude-haiku` |
| `aido/groq/<model>` | Groq | `aido/groq/llama-3.1-8b-instant` |
| `aido/google/<model>` | Google | `aido/google/gemini-1.5-flash` |
| `aido/ollama/<model>` | Ollama Cloud | `aido/ollama/llama3` |
| `aido/ollama-local/<model>` | Ollama Local | `aido/ollama-local/qwen3:8b` |
| `aido/openrouter/<model>` | OpenRouter | `aido/openrouter/nvidia/nemotron-3-super-120b-a12b:free` |
| `aido/auto` | Auto-route | Tries all providers |
| `aido/cloud` | Cloud auto | Tries cloud providers |
| `aido/local` | Local auto | Tries local Ollama |

---

## 9. FLOW DIAGRAMS

### 9.1 Complete Request Flow (aido run)

```
User Input: aido run -m aido/zen/minimax-m2.5-free "Hello"

    ┌─────────────────────────────────────────────────────────┐
    │ 1. cli.ts: Parse command                                │
    │    ├─ provider = 'zen'                                  │
    │    └─ model = 'minimax-m2.5-free'                       │
    └────────────────────┬────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────┐
    │ 2. run.ts: Execute request                              │
    │    ├─ freeModels = getFreeModels('zen')                 │
    │    ├─ selectedModel = model ?? freeModels[0] ?? default │
    │    │   → selectedModel = 'minimax-m2.5-free' (from -m)  │
    │    ├─ key = rotator.next()                              │
    │    └─ API call to provider                              │
    └────────────────────┬────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────┐
    │ 3. Provider API: Process request                        │
    │    ├─ Rate limit check                                  │
    │    ├─ Model execution                                   │
    │    └─ Return response                                   │
    └────────────────────┬────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────┐
    │ 4. Response to user                                     │
    └─────────────────────────────────────────────────────────┘
```

### 9.2 Proxy Flow

```
Client: POST http://localhost:4141/v1/chat/completions
Body: {"model": "aido/zen/minimax-m2.5-free", "messages": [...]}

    ┌─────────────────────────────────────────────────────────┐
    │ 1. proxy.ts: Receive HTTP request                       │
    └────────────────────┬────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────┐
    │ 2. router.ts: Parse model name                          │
    │    parseAidoModel("aido/zen/minimax-m2.5-free")         │
    │    → { provider: 'zen', model: 'minimax-m2.5-free' }    │
    └────────────────────┬────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────┐
    │ 3. auto.ts: forwardAuto()                               │
    │    ├─ rotator = getRotator('zen')                       │
    │    ├─ key = rotator.next()                              │
    │    ├─ API call with model='minimax-m2.5-free'           │
    │    └─ Return response to client                         │
    └────────────────────┬────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────┐
    │ 4. Client receives response                             │
    └─────────────────────────────────────────────────────────┘
```

### 9.3 Free Model Discovery Flow

```
    ┌─────────────────────────────────────────────────────────┐
    │ Background Task: Periodic model discovery               │
    └────────────────────┬────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────┐
    │ 1. fetchModels(provider)                                │
    │    Calls provider API to get list of available models   │
    └────────────────────┬────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────┐
    │ 2. identifyFreeModels(provider, models)                 │
    │    ├─ Zen: endsWith('-free') OR id === 'big-pickle'     │
    │    ├─ OpenRouter: endsWith(':free')                     │
    │    ├─ Google: check against free model list             │
    │    └─ Others: isFree = false                            │
    └────────────────────┬────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────┐
    │ 3. saveModels(provider, freeModels)                     │
    │    INSERT INTO models (..., isFree, ...)                │
    │    ON CONFLICT UPDATE isFree                            │
    └────────────────────┬────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────┐
    │ 4. User runs: aido run "Hello"                          │
    │    getFreeModels('zen')                                 │
    │    SELECT * FROM models WHERE isFree=1                  │
    └─────────────────────────────────────────────────────────┘
```

---

## 10. DATABASE OPERATIONS

### 10.1 When Data is Written

| Operation | When | Table |
|-----------|------|-------|
| Add API key | `aido add <key>` | `.env` file |
| Mark rate limit | On 429 response | `rate_limits` |
| Mark model limit | On 429 response | `model_limits` |
| Save models | After fetching from API | `models` |
| Log request | After API call | `request_log` |

### 10.2 When Data is Read

| Operation | When | Table |
|-----------|------|-------|
| Get free models | Every `aido run` | `models` (WHERE isFree=1) |
| Check rate limit | Before API call | `rate_limits` |
| Check model limit | Before API call | `model_limits` |
| Get available keys | Before API call | `.env` + `rate_limits` |

---

## 11. COMMON SCENARIOS AND EXPECTED BEHAVIOR

### Scenario 1: User wants to use a specific free model

```bash
aido run -m aido/zen/minimax-m2.5-free "Hello"
```

**Expected**: Uses `minimax-m2.5-free` directly (from -m flag)
**Check**: src/run.ts line 69 - `model ?? freeModels[0]`

### Scenario 2: User wants to use first available free model

```bash
aido run -p zen "Hello"
```

**Expected**: Uses first model from `getFreeModels('zen')`
**Check**: src/run.ts line 69 - `freeModels[0].id`

### Scenario 3: User wants auto-routing across providers

```bash
aido run "Hello"
```

**Expected**: Triggers `forwardAuto()` which tries multiple providers
**Check**: src/run.ts line 35-63 - provider === 'auto' branch

### Scenario 4: User wants to try free models across all providers

```bash
aido run --auto-free "Hello"
```

**Expected**: Triggers `forwardAutoFree()` which loops through all providers
**Check**: src/cli.ts line 56-68 - uses forwardAutoFree()

### Scenario 5: Proxy request with specific model

```bash
# Client sends:
POST http://localhost:4141/v1/chat/completions
{"model": "aido/zen/minimax-m2.5-free", "messages": [...]}

# Expected: Uses minimax-m2.5-free directly
```

**Check**: src/auto.ts forwardAuto() - uses model from parsed request

---

## 12. CONFIGURATION FILES

### 12.1 .env (API Keys)

```
ZEN_KEYS=sk-zen-key1,sk-zen-key2
OPENAI_KEYS=sk-proj-key1
ANTHROPIC_KEYS=sk-ant-key1
GROQ_KEYS=gsk_key1
GOOGLE_KEYS=AIza...
OLLAMA_KEYS=...
OPENROUTER_KEYS=sk-or-v1-key1
```

### 12.2 aido.db (SQLite Database)

Tables:
- `models` - All models with isFree flag
- `rate_limits` - Per-key rate limiting
- `model_limits` - Per-model rate limiting
- `request_log` - Request history
- `searched_sources` - Hunt daemon tracking

---

## 13. VERIFICATION CHECKLIST

When reviewing code, check these potential issues:

- [ ] **Model selection**: Does `-m` flag override free model selection?
  - Check: src/run.ts line 69 uses `??` operator correctly

- [ ] **Provider detection**: Does router parse model names correctly?
  - Check: src/models/router.ts handles all formats

- [ ] **Free model identification**: Are all free models correctly tagged?
  - Check: src/free-discovery.ts has correct logic per provider

- [ ] **Rate limiting**: Are both key and model rate limits tracked?
  - Check: src/rotator.ts uses both rate_limits and model_limits

- [ ] **WAL mode**: Is SQLite in WAL mode for concurrent access?
  - Check: src/db.ts has `PRAGMA journal_mode=WAL;`

- [ ] **Cache expiration**: Do models expire from cache?
  - Check: getFreeModels() filters by `expires_at > NOW()`

- [ ] **Auto-routing**: Does forwardAuto try multiple providers?
  - Check: src/auto.ts loops through providers

- [ ] **Free model fallback**: Does it fall back to paid models?
  - Check: src/auto.ts forwardAutoFree() fallback logic

---

## 14. QUICK REFERENCE: WHERE TO LOOK

| Question | File | Line/Function |
|----------|------|---------------|
| How is model selected with -m flag? | src/run.ts | line 69 |
| How does auto-routing work? | src/auto.ts | forwardAuto() |
| How are free models identified? | src/free-discovery.ts | identifyFreeModels() |
| How are models saved to DB? | src/db.ts | saveModels() |
| How are free models retrieved? | src/db.ts | getFreeModels() |
| How does key rotation work? | src/rotator.ts | KeyRotator class |
| How is model name parsed? | src/models/router.ts | parseAidoModel() |
| How is proxy request handled? | src/proxy.ts | startProxy() |
| How are rate limits tracked? | src/db.ts | markRateLimited() |
| How are model limits tracked? | src/db.ts | markModelRateLimited() |

---

## 15. TESTING

Run tests to verify logic:
```bash
npm test                    # All 162 tests
npm test -- tests/db-models.test.ts  # Database tests
npm test -- tests/free-discovery.test.ts  # Free model tests
```

---

**End of PROJECT.md**
