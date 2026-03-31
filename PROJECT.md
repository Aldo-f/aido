# AIdo Project Architecture

**Purpose:** AIdo is a local API key rotation proxy for LLM providers with automatic free model discovery.

> **AIdo** = **AI** + **Aldo** — Aldo's personal AI helper for managing API keys and model routing.

---

## 1. PROJECT STRUCTURE OVERVIEW

```
aido/
├── src/
│   ├── cli.ts              # Entry point - parses commands and routes to handlers
│   ├── run.ts              # Direct CLI execution (AIdo run command)
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

### 2.1 Direct CLI Execution (`AIdo run`)

**Flow:** `CLI → run() → API call → Response`

```
User runs: AIdo run -m aido/opencode/big-pickle "Hello"

1. cli.ts parses arguments
   ├─ provider = 'opencode' (from model name)
   ├─ model = 'big-pickle'
   └─ prompt = "Hello"

2. run() function executes:
   ├─ If model specified (-m flag):
   │  ├─ Validates model exists in DB
   │  └─ Uses THAT model directly
   ├─ If no model:
   │  ├─ Gets free models from DB for provider
   │  ├─ Tries each free model until one succeeds
   │  └─ Falls back to DEFAULT_MODELS[provider] if all fail
   ├─ Gets next available key from rotator
   ├─ Makes direct API call to provider
   └─ Returns response

Key Points:
- Runs ONCE per command (or until success)
- Uses provider-specific key
- Model selection is EXPLICIT when -m is used
- Model VALIDATION: Checks if specified model exists in DB
- FALLBACK: Tries multiple models if first fails (429, error, etc.)
```

**✅ MODEL VALIDATION**:
```typescript
// In src/run.ts lines 62-68:
if (model) {
  const modelInfo = getModel(provider, model);
  if (!modelInfo) {
    console.error(`[run] Model '${model}' not found for provider '${provider}'`);
    console.error(`[run] Available models: ${getAllModels(provider).map(m => m.id).join(', ')}`);
    process.exit(1);
  }
}
```

**✅ FALLBACK LOGIC**:
```typescript
// In src/run.ts lines 78-156:
for (const selectedModel of modelsToTry) {
  // Try each model until one succeeds
  // If 429 or error, continue to next model
}
if (all models fail) exit with error
```

---

### 2.2 HTTP Proxy Server (`aido proxy`)

**Flow**: `Client → Proxy → Router → Auto-routing → API → Response`

```
User runs: aido proxy
Server starts on http://localhost:4141

Client sends: POST http://localhost:4141/v1/chat/completions
Body: {"model": "aido/opencode/big-pickle", "messages": [...]}

1. proxy.ts receives request
   ├─ Parses model name from request body
   ├─ Routes to appropriate handler based on URL path

2. Router (src/models/router.ts) parses model name:
   ├─ "aido/opencode/big-pickle" → provider='opencode', model='big-pickle'
   ├─ "aido/auto" → provider='auto', model='auto'
   ├─ "aido/cloud" → provider='opencode', model='auto' (cloud priority)
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

## 3. KEY DIFFERENCES: AIdo run vs proxy

| Feature | `AIdo run` | `AIdo proxy` |
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
provider      TEXT    NOT NULL    -- 'opencode', 'openai', etc.
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
    case 'opencode':
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
   rotator = getRotator('opencode')

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

### 6.1 Flow: `AIdo run -m aido/opencode/minimax-m2.5-free "Hello"`

```
CLI Input:
  command: run
  model: aido/opencode/minimax-m2.5-free
  prompt: "Hello"

Processing in cli.ts:
  1. Parse model name: "aido/opencode/minimax-m2.5-free"
     ├─ provider = 'opencode' (from path)
     └─ model = 'minimax-m2.5-free' (from path)

  2. Call run(prompt, { provider: 'opencode', model: 'minimax-m2.5-free' })

Processing in run.ts:
  1. Get free models for 'opencode' provider
     freeModels = getFreeModels('opencode')
     // Returns array of models where isFree=1

  2. Select model
     selectedModel = model ?? (freeModels[0]?.id ?? DEFAULT_MODELS['opencode'])
     // Since model IS specified: selectedModel = 'minimax-m2.5-free'
     // NOT from freeModels array!

  3. Get API key
     key = rotator.next()  // Gets next available key for opencode

  4. Make API call
     POST https://opencode.ai/opencode/v1/chat/completions
     Body: {"model": "minimax-m2.5-free", "messages": [...]}

  5. Return response to user
```

**✅ THIS IS CORRECT** - The model from -m flag is used directly.

---

### 6.2 Flow: `AIdo run "Hello"` (no -m flag)

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

  3. If provider is specific (e.g., 'opencode'):
     ├─ Gets all models for 'opencode' from DB
     ├─ Filters by strategy (free/paid/both)
     ├─ Tries each model until one succeeds
     └─ Falls back to DEFAULT_MODELS[provider] if all fail
```

**✅ CORRECT**: If you specify `-p opencode` without `-m`, it will try free models first, then paid, until one succeeds.

---

### 6.3 Flow: HTTP Proxy Request

```
Client sends:
  POST http://localhost:4141/v1/chat/completions
  Body: {"model": "aido/opencode/minimax-m2.5-free", "messages": [...]}

Processing in proxy.ts:
  1. Receive request
  2. Parse body JSON
  3. Extract model name: "aido/opencode/minimax-m2.5-free"

Processing in router.ts:
  parseAidoModel("aido/opencode/minimax-m2.5-free")
  Returns: { provider: 'opencode', model: 'minimax-m2.5-free', priorityType: 'auto' }

Processing in auto.ts (forwardAuto):
  1. rotator = getRotator('opencode')
  2. key = rotator.next()
  3. Make API call with model='minimax-m2.5-free'
  4. Return response
```

**Key Difference**: Model comes from HTTP request body, not command line.

---

## 7. POTENTIAL LOGIC MISTAKES TO WATCH FOR

### 7.1 Model Selection & Validation

| Scenario | Expected Behavior | Implementation |
|----------|-------------------|----------------|
| `AIdo run -m aido/opencode/model "hi"` | Uses `model` directly, validates exists | ✅ getModel() checks DB |
| `AIdo run -p opencode -m model "hi"` | Uses `model` directly, validates exists | ✅ getModel() checks DB |
| `AIdo run -p opencode "hi"` | Tries free models, then paid, until success | ✅ Fallback loop in run() |
| `AIdo run "hi"` | Uses auto-routing across providers | ✅ forwardAuto() |

**Model Validation** (src/run.ts lines 62-68):
```typescript
if (model) {
  const modelInfo = getModel(provider, model);
  if (!modelInfo) {
    console.error(`[run] Model '${model}' not found for provider '${provider}'`);
    console.error(`[run] Available models: ${getAllModels(provider).map(m => m.id).join(', ')}`);
    process.exit(1);
  }
}
```

**Fallback Logic** (src/run.ts lines 78-156):
```typescript
for (const selectedModel of modelsToTry) {
  // Try each model until one succeeds
  // If 429 or error, continue to next model
}
if (all models fail) exit with error
```

**Strategy Options** (src/run.ts line 60):
- `--only-free`: Only try free models
- `--only-paid`: Only try paid models
- Default (no flag): Try free first, then paid (both)

### 7.2 Provider Detection Mistakes

| Model Name | Expected Provider | Potential Bug |
|------------|-------------------|---------------|
| `aido/opencode/big-pickle` | opencode | ❌ If router doesn't parse correctly |
| `aido/auto` | auto (triggers forwardAuto) | ❌ If treated as specific provider |
| `big-pickle` (no prefix) | Depends on context | ❌ Ambiguous |

**Check in src/models/router.ts**:
```typescript
export function parseAidoModel(path: string): ParsedAidoModel {
  // Should handle: "aido/opencode/big-pickle", "aido/auto", "big-pickle"
}
```

### 7.3 Free Model Discovery Mistakes

| Scenario | Expected | Potential Bug |
|----------|----------|---------------|
| Opencode model ends with `-free` | isFree = true | ❌ If regex doesn't match |
| Opencode model is `big-pickle` | isFree = true | ❌ If special case not handled |
| OpenRouter model ends with `:free` | isFree = true | ❌ If regex doesn't match |
| Google model is `gemini-1.5-flash` | isFree = true | ❌ If not in free list |

**Check in src/free-discovery.ts**:
```typescript
case 'opencode':
  return m.id.endsWith('-free') || m.id === 'big-pickle';
case 'openrouter':
  return m.id.endsWith(':free');
```

### 7.4 Rate Limiting

| Scenario | Expected | Implementation |
|----------|----------|----------------|
| Key gets 429 response | Key marked in rate_limits | ✅ markRateLimited() |
| Model gets 429 response | Model marked in model_limits | ✅ markModelRateLimited() |
| After 1 hour cooldown | Key/model available again | ✅ Automatic (timestamp check) |

**No Cleanup Needed**: Rate limits expire automatically when `limited_until > Date.now()` is false.
The `isRateLimited()` function checks the timestamp, no background cleanup required.

**Check in src/db.ts**:
```typescript
export function markRateLimited(key: string, provider: string, cooldownSeconds: number)
export function markModelRateLimited(provider: string, modelId: string, cooldownSeconds: number)
export function isRateLimited(key: string): boolean {
  // Returns false when limited_until <= Date.now()
}
```

---

## 8. COMMAND REFERENCE

### 8.1 CLI Commands

```bash
# Direct execution (one-time)
AIdo run "Hello"                    # Auto-route to best provider
AIdo run -m aido/opencode/big-pickle "Hello"  # Specific model (validated)
AIdo run -p opencode "Hello"             # Specific provider, tries free then paid
AIdo run -p opencode --only-free "Hello" # Only try free models
AIdo run -p opencode --only-paid "Hello" # Only try paid models

# Proxy server (continuous)
AIdo proxy                          # Start proxy on port 4141
AIdo stop                           # Stop proxy

# Model management
AIdo models                         # List all models (cached 1 hour)
AIdo models opencode                     # List models for specific provider
AIdo models --sync                  # Force refresh cache

# Key management
AIdo add sk-opencode-key...              # Add API key
AIdo status                         # Show configured providers & rate limits
AIdo clear                          # Clear all rate limits

# Hunt daemon
AIdo hunt                           # Search for leaked keys
AIdo hunt:stop                      # Stop hunt daemon
```

### 8.2 Model Name Formats

**⚠️ CRITICAL**: Model names MUST start with `aido/` prefix!

| Format | Provider | Example |
|--------|----------|---------|
| `aido/opencode/<model>` | Opencode | `aido/opencode/big-pickle` |
| `aido/openai/<model>` | OpenAI | `aido/openai/gpt-4o-mini` |
| `aido/anthropic/<model>` | Anthropic | `aido/anthropic/claude-haiku` |
| `aido/groq/<model>` | Groq | `aido/groq/llama-3.1-8b-instant` |
| `aido/google/<model>` | Google | `aido/google/gemini-1.5-flash` |
| `aido/ollama/<model>` | Ollama Cloud | `aido/ollama/llama3` |
| `aido/ollama-local/<model>` | Ollama Local | `aido/ollama-local/qwen3:8b` |
| `aido/openrouter/<model>` | OpenRouter | `aido/openrouter/nvidia/nemotron-3-super-120b-a12b:free` |
| `aido/auto/<model>` | Auto-route | Check all providers for model |
| `aido/cloud/<model>` | Cloud auto | Check cloud providers for model |
| `aido/local/<model>` | Local auto | Check local Ollama for model |

### 8.3 Common Mistakes

| Command | Result |
|---------|--------|
| `AIdo run -m minimax-m2.5-free "hi"` | ❌ ERROR: Unknown category/provider |
| `AIdo run -m aido/opencode/minimax-m2.5-free "hi"` | ✅ Uses Opencode provider with that model |
| `AIdo run -m aido/auto/minimax-m2.5-free "hi"` | ✅ Checks ALL providers for that model |

---

## 9. FLOW DIAGRAMS

### 9.1 Complete Request Flow (AIdo run)

```
User Input: AIdo run -m aido/opencode/minimax-m2.5-free "Hello"

    ┌─────────────────────────────────────────────────────────┐
    │ 1. cli.ts: Parse command                                │
    │    ├─ provider = 'opencode'                                  │
    │    └─ model = 'minimax-m2.5-free'                       │
    └────────────────────┬────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────┐
    │ 2. run.ts: Execute request                              │
    │    ├─ freeModels = getFreeModels('opencode')                 │
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
Body: {"model": "aido/opencode/minimax-m2.5-free", "messages": [...]}

    ┌─────────────────────────────────────────────────────────┐
    │ 1. proxy.ts: Receive HTTP request                       │
    └────────────────────┬────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────┐
    │ 2. router.ts: Parse model name                          │
    │    parseAidoModel("aido/opencode/minimax-m2.5-free")         │
    │    → { provider: 'opencode', model: 'minimax-m2.5-free' }    │
    └────────────────────┬────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────┐
    │ 3. auto.ts: forwardAuto()                               │
    │    ├─ rotator = getRotator('opencode')                       │
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
    │    ├─ Opencode: endsWith('-free') OR id === 'big-pickle'     │
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
    │ 4. User runs: AIdo run "Hello"                          │
    │    getFreeModels('opencode')                                 │
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
| Get free models | Every `AIdo run` | `models` (WHERE isFree=1) |
| Check rate limit | Before API call | `rate_limits` |
| Check model limit | Before API call | `model_limits` |
| Get available keys | Before API call | `.env` + `rate_limits` |

---

## 11. COMMON SCENARIOS AND EXPECTED BEHAVIOR

### Scenario 1: User wants to use a specific free model

```bash
AIdo run -m aido/opencode/minimax-m2.5-free "Hello"
```

**Expected**: Uses `minimax-m2.5-free` directly (from -m flag)
**Check**: src/run.ts line 69 - `model ?? freeModels[0]`

### Scenario 2: User wants to use first available free model

```bash
AIdo run -p opencode "Hello"
```

**Expected**: Uses first model from `getFreeModels('opencode')`
**Check**: src/run.ts line 69 - `freeModels[0].id`

### Scenario 3: User wants auto-routing across providers

```bash
AIdo run "Hello"
```

**Expected**: Triggers `forwardAuto()` which tries multiple providers
**Check**: src/run.ts line 35-63 - provider === 'auto' branch

### Scenario 4: User wants to try only free models across all providers

```bash
AIdo run --provider opencode --only-free "Hello"
```

**Expected**: Triggers `forwardAutoFree()` which loops through all providers
**Check**: src/cli.ts line 56-68 - uses forwardAutoFree()

### Scenario 5: Proxy request with specific model

```bash
# Client sends:
POST http://localhost:4141/v1/chat/completions
{"model": "aido/opencode/minimax-m2.5-free", "messages": [...]}

# Expected: Uses minimax-m2.5-free directly
```

**Check**: src/auto.ts forwardAuto() - uses model from parsed request

---

## 12. CONFIGURATION FILES

### 12.1 .env (API Keys)

```
OPENCODE_KEYS=sk-opencode-key1,sk-opencode-key2
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

- [ ] **Model validation**: Does `-m` flag validate model exists?
  - Check: src/run.ts lines 62-68 - getModel() check before use

- [ ] **Model selection**: Does `-m` flag override free model selection?
  - Check: src/run.ts line 69 uses `??` operator correctly

- [ ] **Fallback logic**: Does it try multiple models on failure?
  - Check: src/run.ts lines 78-156 - for loop with continue on error

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

- [ ] **Strategy flags**: Are --only-free and --only-paid clear?
  - Check: src/cli.ts lines 49-64 - strategy option handling

---

## 14. QUICK REFERENCE: WHERE TO LOOK

| Question | File | Line/Function |
|----------|------|---------------|
| How is model validated with -m flag? | src/run.ts | lines 62-68 - getModel() |
| How is model selected with -m flag? | src/run.ts | line 69 - `model ?? ...` |
| How does fallback logic work? | src/run.ts | lines 78-156 - for loop |
| How does auto-routing work? | src/auto.ts | forwardAuto() |
| How are free models identified? | src/free-discovery.ts | identifyFreeModels() |
| How are models saved to DB? | src/db.ts | saveModels() |
| How are free models retrieved? | src/db.ts | getFreeModels() |
| How to get a specific model? | src/db.ts | getModel(provider, modelId) |
| How to get all models? | src/db.ts | getAllModels(provider) |
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
