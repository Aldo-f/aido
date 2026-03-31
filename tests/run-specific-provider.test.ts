import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

process.env.DB_PATH = ':memory:';

const { resetDb, saveModels } = await import('../src/db.js');
const { parseAidoModelName } = await import('../src/models/parser.js');
const { routeAidoModel } = await import('../src/models/router.js');

describe('run - specific provider routing', () => {
  beforeEach(() => {
    resetDb();
    vi.stubEnv('OPENCODE_KEYS', '');
    vi.stubEnv('OPENAI_KEYS', '');
    vi.stubEnv('ANTHROPIC_KEYS', '');
    vi.stubEnv('GROQ_KEYS', '');
    vi.stubEnv('GOOGLE_KEYS', '');
    vi.stubEnv('OLLAMA_KEYS', '');
    vi.stubEnv('OPENROUTER_KEYS', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should parse aido/opencode/model format correctly', () => {
    const parsed = parseAidoModelName('aido/opencode/minimax-m2.5-free');
    expect(parsed.category).toBe('provider');
    expect(parsed.provider).toBe('opencode');
    expect(parsed.model).toBe('minimax-m2.5-free');
  });

  it('should route aido/opencode/model to specific provider, not auto-route', () => {
    const route = routeAidoModel('aido/opencode/minimax-m2.5-free');
    expect(route.provider).toBe('opencode');
    expect(route.model).toBe('minimax-m2.5-free');
    expect(route.isAuto).toBe(false);
  });

  it('should route aido/auto to auto-routing', () => {
    const route = routeAidoModel('aido/auto');
    expect(route.provider).toBe('auto');
    expect(route.isAuto).toBe(true);
  });

  it('should route aido/auto/<model> to auto-routing with specific model', () => {
    const route = routeAidoModel('aido/auto/big-pickle');
    expect(route.provider).toBe('auto');
    expect(route.model).toBe('big-pickle');
    expect(route.isAuto).toBe(true);
  });

  it('should verify specific provider routing logic', () => {
    saveModels('opencode', [{
      id: 'minimax-m2.5-free',
      name: 'MiniMax M2.5 Free',
      provider: 'opencode',
      isFree: true,
      discoveredAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    }]);

    const route = routeAidoModel('aido/opencode/minimax-m2.5-free');
    expect(route.provider).toBe('opencode');
    expect(route.isAuto).toBe(false);
  });
});
