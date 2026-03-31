import { describe, it, expect } from 'vitest';

process.env.DB_PATH = ':memory:';

const { applyModelPrefix } = await import('../src/detector.js');
const { parseAidoModelName } = await import('../src/models/parser.js');
const { routeAidoModel } = await import('../src/models/router.js');

describe('applyModelPrefix', () => {
  it('should NOT apply prefix for opencode provider (API uses plain names)', () => {
    const result = applyModelPrefix('opencode', 'big-pickle');
    expect(result).toBe('big-pickle');
  });

  it('should NOT apply prefix for opencode with different models', () => {
    const result = applyModelPrefix('opencode', 'claude-opus-4-6');
    expect(result).toBe('claude-opus-4-6');
  });

  it('should NOT apply prefix for openai provider', () => {
    const result = applyModelPrefix('openai', 'gpt-4');
    expect(result).toBe('gpt-4');
  });

  it('should NOT apply prefix for anthropic provider', () => {
    const result = applyModelPrefix('anthropic', 'claude-3-5-sonnet');
    expect(result).toBe('claude-3-5-sonnet');
  });
});

describe('parseAidoModelName - opencode models', () => {
  it('should parse aido/opencode/big-pickle format', () => {
    const parsed = parseAidoModelName('aido/opencode/big-pickle');
    expect(parsed.category).toBe('provider');
    expect(parsed.provider).toBe('opencode');
    expect(parsed.model).toBe('big-pickle');
  });

  it('should parse aido/opencode/claude-opus-4-6 format', () => {
    const parsed = parseAidoModelName('aido/opencode/claude-opus-4-6');
    expect(parsed.category).toBe('provider');
    expect(parsed.provider).toBe('opencode');
    expect(parsed.model).toBe('claude-opus-4-6');
  });

  it('should throw error for aido/zen/model format (zen no longer valid)', () => {
    expect(() => parseAidoModelName('aido/zen/big-pickle')).toThrow();
  });
});

describe('routeAidoModel - opencode models', () => {
  it('should route aido/opencode/big-pickle to opencode provider', () => {
    const route = routeAidoModel('aido/opencode/big-pickle');
    expect(route.provider).toBe('opencode');
    expect(route.model).toBe('big-pickle');
    expect(route.isAuto).toBe(false);
  });

  it('should route aido/opencode/claude-opus-4-6 to opencode provider', () => {
    const route = routeAidoModel('aido/opencode/claude-opus-4-6');
    expect(route.provider).toBe('opencode');
    expect(route.model).toBe('claude-opus-4-6');
    expect(route.isAuto).toBe(false);
  });

  // New tests for direct provider/model parsing (without aido/ prefix)
  it('should parse opencode/big-pickle without aido/ prefix', () => {
    const parsed = parseAidoModelName('opencode/big-pickle');
    expect(parsed.category).toBe('provider');
    expect(parsed.provider).toBe('opencode');
    expect(parsed.model).toBe('big-pickle');
  });

  it('should parse openai/gpt-4 without aido/ prefix', () => {
    const parsed = parseAidoModelName('openai/gpt-4');
    expect(parsed.category).toBe('provider');
    expect(parsed.provider).toBe('openai');
    expect(parsed.model).toBe('gpt-4');
  });

  it('should route opencode/big-pickle without aido/ prefix', () => {
    const route = routeAidoModel('opencode/big-pickle');
    expect(route.provider).toBe('opencode');
    expect(route.model).toBe('big-pickle');
    expect(route.isAuto).toBe(false);
  });

  it('should route openai/gpt-4 without aido/ prefix', () => {
    const route = routeAidoModel('openai/gpt-4');
    expect(route.provider).toBe('openai');
    expect(route.model).toBe('gpt-4');
    expect(route.isAuto).toBe(false);
  });
});
