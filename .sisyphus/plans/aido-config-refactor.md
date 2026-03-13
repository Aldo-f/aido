# AIdo Config Refactor: Single Provider

## TL;DR

> **Quick Summary**: Refactor OpenCode config from 6 providers to 1. Routing encoded in model name (`aido/zen/big-pickle`).
> 
> **Deliverables**:
> - Proxy routes based on model name in request body (breaking change)
> - OpenCode config with single `aido` provider and full model list
> 
> **Estimated Effort**: Short
> **Parallel Execution**: NO - sequential (small changes)
> **Critical Path**: parser → router → proxy → launch → tests

---

## Context

### Original Request
User wants to simplify OpenCode config. Current has 6 providers (aido, aido-auto, aido-cloud, aido-ollama, aido-local, aido-zen) each with different baseURLs. All route through AIdo proxy anyway, so should be one provider with routing info in model name.

### Requirements
- **Breaking change**: Only new format (no backward compatibility with `/aido/zen/v1/...` paths)
- **Model naming**: Single slashes - `aido/zen/big-pickle`, `aido/auto`, `aido/cloud`, `aido/local`

---

## Work Objectives

### Core Objective
Simplify OpenCode config to single `aido` provider. Proxy parses model name from request body to determine routing.

### Concrete Deliverables
1. New model parser: `aido/zen/big-pickle` → `{provider: 'zen', model: 'big-pickle'}`
2. Updated proxy: route based on model name from body
3. Updated launch: generate single-provider config with all models
4. Tests pass

### Definition of Done
- [ ] `npm test` passes
- [ ] Manual test: `curl -X POST http://localhost:4141/v1/chat/completions -d '{"model":"aido/zen/big-pickle"}'` routes to Zen

### Must Have
- All existing functionality preserved (auto, cloud, local, zen, ollama, etc.)

### Must NOT Have
- No backward compatibility with old path-based routing (`/aido/zen/v1/...`)
- No multiple providers in OpenCode config

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (vitest)
- **Automated tests**: Tests-after
- **Framework**: vitest

---

## Execution Strategy

### Sequential Tasks

---

## TODOs

- [x] 1. Add model name parser for body-based routing

  **What to do**:
  - Add new function in `src/models/parser.ts`: `parseAidoModelName(modelName: string): ParsedAidoModel`
  - Handle formats: `aido/auto`, `aido/cloud`, `aido/local`, `aido/zen/big-pickle`, `aido/ollama/qwen3:8b`, `aido/ollama-local/qwen3:8b`
  - Return same `ParsedAidoModel` structure as existing URL parser

  **Must NOT do**:
  - Don't break existing URL parser (may be used elsewhere)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Skills Evaluated but Omitted**: N/A

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 2
  - **Blocked By**: None

  **References**:
  - `src/models/parser.ts:14-76` - Existing parseAidoModel for reference
  - `src/models/router.ts:36-101` - How routing works

  **Acceptance Criteria**:
  - [ ] parseAidoModelName('aido/auto') → {category: 'auto', provider: null, model: null}
  - [ ] parseAidoModelName('aido/zen/big-pickle') → {category: 'provider', provider: 'zen', model: 'big-pickle'}
  - [ ] parseAidoModelName('aido/ollama/qwen3:8b') → {category: 'provider', provider: 'ollama', model: 'qwen3:8b'}
  - [ ] parseAidoModelName('aido/local') → {category: 'local', provider: null, model: null}

  **QA Scenarios**:

  ```
  Scenario: Parse auto model
    Tool: Bash
    Preconditions: None
    Steps:
      1. node -e "import('./src/models/parser.js').then(m => console.log(JSON.stringify(m.parseAidoModelName('aido/auto'))))"
    Expected Result: {"category":"auto","provider":null,"model":null}
    Evidence: .sisyphus/evidence/task-1-parse-auto.json

  Scenario: Parse specific provider model
    Tool: Bash
    Preconditions: None
    Steps:
      1. node -e "import('./src/models/parser.js').then(m => console.log(JSON.stringify(m.parseAidoModelName('aido/zen/big-pickle'))))"
    Expected Result: {"category":"provider","provider":"zen","model":"big-pickle"}
    Evidence: .sisyphus/evidence/task-1-parse-provider.json
  ```

  **Commit**: YES
  - Message: `feat(parser): add parseAidoModelName for body-based routing`
  - Files: `src/models/parser.ts`

---

- [x] 2. Update router to use new parser

  **What to do**:
  - Modify `routeAidoModel` in `src/models/router.ts` to accept either:
    - Old-style URL path (for backward compat if needed internally)
    - New-style model name from request body
  - Extract provider/model from model name like `aido/zen/big-pickle`
  - Keep priority chains (auto, cloud, local) working

  **Must NOT do**:
  - Don't break existing URL path routing (used by proxy internally)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Skills Evaluated but Omitted**: N/A

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **References**:
  - `src/models/router.ts:36-101` - Current router logic
  - `src/models/parser.ts` - New parser from Task 1

  **Acceptance Criteria**:
  - [ ] routeAidoModel('aido/auto') → provider: 'auto', isAuto: true
  - [ ] routeAidoModel('aido/zen/big-pickle') → provider: 'zen', model: 'big-pickle'
  - [ ] routeAidoModel('aido/cloud') → provider: from CLOUD_PRIORITY[0], isAuto: true

  **QA Scenarios**:

  ```
  Scenario: Route auto model
    Tool: Bash
    Preconditions: None
    Steps:
      1. node -e "import('./src/models/router.js').then(m => console.log(JSON.stringify(m.routeAidoModel('aido/auto'))))"
    Expected Result: {"provider":"auto","model":"big-pickle","upstreamPath":"/v1/chat/completions","isAuto":true}
    Evidence: .sisyphus/evidence/task-2-route-auto.json
  ```

  **Commit**: YES
  - Message: `feat(router): support model-name-based routing`
  - Files: `src/models/router.ts`

---

- [x] 3. Update proxy for body-based routing

  **What to do**:
  - In `src/proxy.ts`, function `resolveProvider`:
    - Remove support for old paths like `/aido/zen/v1/...`, `/aido/auto/v1/...`
    - New behavior: if path is `/aido/v1/...` or `/v1/...`, parse model from request body
    - If body has `"model": "aido/zen/big-pickle"`, route to Zen
  - Need to extract body before forwarding (already done - see line 140-141)
  - Pass body to resolver

  **Must NOT do**:
  - No backward compatibility with old path format

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Skills Evaluated but Omitted**: N/A

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 4
  - **Blocked By**: Task 2

  **References**:
  - `src/proxy.ts:20-55` - Current resolveProvider
  - `src/proxy.ts:137-145` - Where body is available

  **Acceptance Criteria**:
  - [ ] Path `/v1/chat/completions` with body `{"model":"aido/zen/big-pickle"}` routes to Zen
  - [ ] Path `/v1/chat/completions` with body `{"model":"aido/auto"}` routes to auto
  - [ ] Path `/v1/chat/completions` with body `{"model":"aido/local"}` routes to ollama-local

  **QA Scenarios**:

  ```
  Scenario: Route based on model in body
    Tool: interactive_bash
    Preconditions: Proxy running on port 4141
    Steps:
      1. Start proxy in background: cd /mnt/storage/Documents/GitCode/aido && npm run proxy &
      2. Wait 2s for proxy to start
      3. curl -s -X POST http://localhost:4141/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"aido/zen/big-pickle","messages":[{"role":"user","content":"hi"}]}'
    Expected Result: Valid response from Zen (or 401 if no key, but not 404)
    Evidence: .sisyphus/evidence/task-3-body-routing.json
  ```

  **Commit**: YES
  - Message: `feat(proxy): route based on model name in request body`
  - Files: `src/proxy.ts`

---

- [x] 4. Update launch to generate single-provider config

  **What to do**:
  - Rewrite `src/launch.ts` function `launchOpenCode`:
    - Single provider named `aido`
    - baseURL: `http://localhost:${port}/v1` (not `/aido/v1`)
    - All models in one object with full names:
      - `aido/auto` → "⚡ Auto (best available)"
      - `aido/cloud` → "☁️ Cloud Auto"
      - `aido/local` → "Local Ollama Auto"
      - `aido/zen/big-pickle` → "Big Pickle (Free)"
      - `aido/zen/mimo-v2-flash-free` → "MiMo V2 Flash (Free)"
      - `aido/zen/nemotron-3-super-free` → "Nemotron 3 Super (Free)"
      - `aido/zen/minimax-m2.5-free` → "MiniMax M2.5 (Free)"
      - `aido/ollama/glm-5:cloud` → "GLM-5 Cloud"
      - `aido/ollama/kimi-k2.5:cloud` → "Kimi K2.5 Cloud"
      - `aido/ollama/minimax-m2.5:cloud` → "MiniMax M2.5 Cloud"
      - Plus local Ollama models
  - Default model: `aido/auto`

  **Must NOT do**:
  - No more multiple providers (aido, aido-auto, aido-cloud, etc.)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Skills Evaluated but Omitted**: N/A

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 5
  - **Blocked By**: Task 3

  **References**:
  - `src/launch.ts:80-180` - Current launchOpenCode

  **Acceptance Criteria**:
  - [ ] Generated config has single `aido` provider
  - [ ] All model names use `aido/` prefix
  - [ ] Default model is `aido/auto`

  **QA Scenarios**:

  ```
  Scenario: Generate new config format
    Tool: Bash
    Preconditions: None
    Steps:
      1. cd /mnt/storage/Documents/GitCode/aido
      2. npm run build
      3. node dist/cli.js launch --target opencode 2>&1 | head -20
    Expected Result: Config written with single 'aido' provider
    Evidence: .sisyphus/evidence/task-4-launch.json
  ```

  **Commit**: YES
  - Message: `feat(launch): generate single-provider OpenCode config`
  - Files: `src/launch.ts`

---

- [x] 5. Run tests and fix any failures

  **What to do**:
  - Run `npm test`
  - Fix any test failures related to:
    - Old path format expectations
    - Provider name changes
  - Update test expectations to match new model naming

  **Must NOT do**:
  - Don't skip tests

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Skills Evaluated but Omitted**: N/A

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: None
  - **Blocked By**: Task 4

  **References**:
  - `tests/parser.test.ts` - Parser tests
  - `tests/router.test.ts` - Router tests

  **Acceptance Criteria**:
  - [ ] `npm test` passes

  **QA Scenarios**:

  ```
  Scenario: Run all tests
    Tool: Bash
    Preconditions: None
    Steps:
      1. cd /mnt/storage/Documents/GitCode/aido
      2. npm test
    Expected Result: All tests pass
    Evidence: .sisyphus/evidence/task-5-tests.json
  ```

  **Commit**: YES (if tests fixed)
  - Message: `test: update tests for new routing format`
  - Files: `tests/*.test.ts`

---

## Final Verification Wave

- [x] F1. **Manual E2E Test** — `unspecified-high`
  Start proxy, send request with model `aido/zen/big-pickle`, verify routes to Zen.
  Output: `Routes [PASS/FAIL] | Response [valid/error]`

- [x] F2. **Config Validation** — `quick`
  Verify generated OpenCode config matches expected format.
  Output: `Valid [YES/NO]`

---

## Commit Strategy

- Tasks 1-5: Each commits individually
- Message format: `type(scope): desc`

---

## Success Criteria

### Verification Commands
```bash
npm test  # All tests pass
```

### Final Checklist
- [x] All tests pass
- [x] Manual test confirms routing works
- [x] OpenCode config has single provider
