import { describe, it, expect } from 'vitest';
import { parseAidoModel, isAidoPath } from '../src/models/parser.js';

describe('parseAidoModel', () => {
  describe('valid paths', () => {
    it('parses aido/auto', () => {
      const result = parseAidoModel('aido/auto');
      expect(result).toEqual({ category: 'auto', provider: null, model: null });
    });

    it('parses aido/cloud', () => {
      const result = parseAidoModel('aido/cloud');
      expect(result).toEqual({ category: 'cloud', provider: null, model: null });
    });

    it('parses aido/cloud/big-pickle', () => {
      const result = parseAidoModel('aido/cloud/big-pickle');
      expect(result).toEqual({ category: 'cloud', provider: null, model: 'big-pickle' });
    });

    it('parses aido/local', () => {
      const result = parseAidoModel('aido/local');
      expect(result).toEqual({ category: 'local', provider: null, model: null });
    });

    it('parses aido/local/qwen3:8b (colon in model)', () => {
      const result = parseAidoModel('aido/local/qwen3:8b');
      expect(result).toEqual({ category: 'local', provider: null, model: 'qwen3:8b' });
    });

    it('parses aido/zen/big-pickle', () => {
      const result = parseAidoModel('aido/zen/big-pickle');
      expect(result).toEqual({ category: 'provider', provider: 'zen', model: 'big-pickle' });
    });

    it('parses aido/ollama/glm-5:cloud', () => {
      const result = parseAidoModel('aido/ollama/glm-5:cloud');
      expect(result).toEqual({ category: 'provider', provider: 'ollama', model: 'glm-5:cloud' });
    });

    it('parses aido/openai/gpt-4o-mini', () => {
      const result = parseAidoModel('aido/openai/gpt-4o-mini');
      expect(result).toEqual({ category: 'provider', provider: 'openai', model: 'gpt-4o-mini' });
    });

    it('parses aido/anthropic/claude-haiku-4-5', () => {
      const result = parseAidoModel('aido/anthropic/claude-haiku-4-5');
      expect(result).toEqual({ category: 'provider', provider: 'anthropic', model: 'claude-haiku-4-5' });
    });

    it('parses aido/groq/llama3-8b-8192', () => {
      const result = parseAidoModel('aido/groq/llama3-8b-8192');
      expect(result).toEqual({ category: 'provider', provider: 'groq', model: 'llama3-8b-8192' });
    });

    it('parses aido/google/gemini-pro', () => {
      const result = parseAidoModel('aido/google/gemini-pro');
      expect(result).toEqual({ category: 'provider', provider: 'google', model: 'gemini-pro' });
    });

    it('parses aido/ollama-local/qwen3:8b', () => {
      const result = parseAidoModel('aido/ollama-local/qwen3:8b');
      expect(result).toEqual({ category: 'provider', provider: 'ollama-local', model: 'qwen3:8b' });
    });

    it('preserves case in model name', () => {
      const result = parseAidoModel('aido/cloud/Big-Pickle');
      expect(result).toEqual({ category: 'cloud', provider: null, model: 'Big-Pickle' });
    });

    it('handles uppercase category/provider', () => {
      const result = parseAidoModel('AIDO/CLOUD/big-pickle');
      expect(result).toEqual({ category: 'cloud', provider: null, model: 'big-pickle' });
    });
  });

  describe('edge cases', () => {
    it('trims whitespace', () => {
      const result = parseAidoModel('  aido/auto  ');
      expect(result).toEqual({ category: 'auto', provider: null, model: null });
    });

    it('handles leading slash', () => {
      const result = parseAidoModel('/aido/auto');
      expect(result).toEqual({ category: 'auto', provider: null, model: null });
    });

    it('handles trailing slash', () => {
      const result = parseAidoModel('aido/cloud/');
      expect(result).toEqual({ category: 'cloud', provider: null, model: null });
    });

    it('handles multiple slashes', () => {
      const result = parseAidoModel('//aido//cloud//');
      expect(result).toEqual({ category: 'cloud', provider: null, model: null });
    });
  });

  describe('invalid paths', () => {
    it('throws for empty string', () => {
      expect(() => parseAidoModel('')).toThrow("Path is required");
    });

    it('throws for whitespace only', () => {
      expect(() => parseAidoModel('   ')).toThrow("Path cannot be empty");
    });

    it('throws for just aido/', () => {
      expect(() => parseAidoModel('aido/')).toThrow("Missing category");
    });

    it('throws for aido/unknown', () => {
      expect(() => parseAidoModel('aido/unknown')).toThrow("Unknown category or provider");
    });

    it('throws for aido/auto/model', () => {
      expect(() => parseAidoModel('aido/auto/model')).toThrow("does not accept a model name");
    });

    it('throws for aido/zen (missing model)', () => {
      expect(() => parseAidoModel('aido/zen')).toThrow("Missing model name");
    });

    it('throws for non-aido path', () => {
      expect(() => parseAidoModel('big-pickle')).toThrow("must start with 'aido/'");
    });
  });
});

describe('isAidoPath', () => {
  it('returns true for aido/auto', () => {
    expect(isAidoPath('aido/auto')).toBe(true);
  });

  it('returns true for aido/cloud/big-pickle', () => {
    expect(isAidoPath('aido/cloud/big-pickle')).toBe(true);
  });

  it('returns true for /aido/auto', () => {
    expect(isAidoPath('/aido/auto')).toBe(true);
  });

  it('returns false for big-pickle', () => {
    expect(isAidoPath('big-pickle')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAidoPath('')).toBe(false);
  });

  it('returns false for whitespace only', () => {
    expect(isAidoPath('   ')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isAidoPath(null as any)).toBe(false);
    expect(isAidoPath(undefined as any)).toBe(false);
  });
});
