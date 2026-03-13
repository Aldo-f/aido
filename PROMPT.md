# aido-proxy — Test & Verify Prompt

You are testing the `aido` project. This is a local API key rotation proxy for LLM providers (Zen, OpenAI, Anthropic, ...). Your job is to verify that everything works end-to-end using TDD principles.

## Context

- Project is located in the current directory
- Node.js v22+ is required (uses built-in `node:sqlite`)
- The `aido` wrapper script in the root runs the CLI
- `.env` holds the API keys (already populated by the user)
- `aido.db` is auto-created on first run

## Step 1 — Setup

```bash
npm install
npm test
```

All 37 tests must pass before continuing. If any fail, fix them first — do not proceed until green.

## Step 2 — Smoke test the CLI

```bash
./aido --help
./aido status
```

Expected: status shows at least one configured provider (zen).

## Step 3 — Test `aido models`

```bash
./aido models zen
```

Expected:
- Makes a real HTTP call to `https://opencode.ai/zen/v1/models` with the key from `.env`
- Prints a list of models grouped by `owned_by`
- Shows `big-pickle`, `mimo-v2-flash-free`, `nemotron-3-super-free`, `minimax-m2.5-free` among the free ones
- Second call (without `--sync`) should NOT make a new HTTP request (cache)
- `./aido models zen --sync` should make a new HTTP request

If the model list differs from what's hardcoded in `src/launch.ts` (the `ZEN_FREE_MODELS` constant), update `src/launch.ts` to match the current free models from the API response.

## Step 4 — Test `aido run`

```bash
./aido run "reply with only the number 4, nothing else" --model big-pickle
```

Expected:
- Connects to Zen API
- Returns a response containing "4"
- No crash, no stacktrace

If it returns a 429, the key is rate-limited. Run `./aido status` to confirm, then try a different model:
```bash
./aido run "reply with only the number 4" --model mimo-v2-flash-free
```

## Step 5 — Test key rotation (simulate 429)

Write a small inline test script to verify rotation logic works correctly:

```bash
node --experimental-sqlite --import ./node_modules/tsx/dist/esm/index.cjs - << 'EOF'
import 'dotenv/config';
process.env.DB_PATH = ':memory:';
const { resetDb, markRateLimited } = await import('./src/db.ts');
const { KeyRotator } = await import('./src/rotator.ts');

resetDb();
const keys = process.env.ZEN_KEYS?.split(',').filter(Boolean) ?? [];
if (keys.length < 2) {
  console.log('Only 1 key configured — rotation test skipped (add more keys to test rotation)');
  process.exit(0);
}

const rotator = new KeyRotator('zen', keys);
const first = rotator.next();
rotator.markLimited(first, 5); // 5 second cooldown
const second = rotator.next();
console.assert(first !== second, 'Rotation failed: same key returned after marking as limited');
console.log(`✓ Rotation works: ${first?.slice(-6)} → ${second?.slice(-6)}`);
EOF
```

## Step 6 — Test `aido proxy` + real request

Start the proxy in the background and send a real request through it:

```bash
./aido proxy &
PROXY_PID=$!
sleep 1

curl -s http://localhost:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer aido-proxy" \
  -d '{
    "model": "big-pickle",
    "messages": [{"role": "user", "content": "reply with only the word HELLO"}]
  }' | grep -i "hello"

kill $PROXY_PID
```

Expected: response contains "HELLO".

## Step 7 — Test `aido launch --target opencode`

```bash
./aido launch --target opencode
cat ~/.config/opencode/opencode.json
```

Expected JSON shape:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "aido/big-pickle",
  "provider": {
    "aido": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "AIdo Proxy (Zen)",
      "options": {
        "baseURL": "http://localhost:4141/v1",
        "apiKey": "aido-proxy"
      },
      "models": { ... }
    }
  }
}
```

## Step 8 — Run full test suite one more time

```bash
npm test
```

All 37 tests must still pass.

## What to report

After completing all steps, summarize:

1. ✅/❌ Unit tests (37 expected)
2. ✅/❌ `aido models zen` — real API call works + cache works
3. ✅/❌ `aido run` — real completion returned
4. ✅/❌ Rotation logic — correct key skipped after 429
5. ✅/❌ Proxy — real HTTP request forwarded correctly
6. ✅/❌ Launch — correct config written

If anything fails, fix it and describe what was wrong and what you changed.

## Rules

- Run `npm test` after every fix — never leave tests broken
- Do not change test files unless a test is genuinely wrong (and explain why)
- Do not hardcode API keys anywhere in source files
- Keep changes minimal — only fix what's actually broken
