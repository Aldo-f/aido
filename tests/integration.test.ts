import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.DB_PATH = ':memory:';
process.env.ZEN_KEYS = 'sk-' + 'z'.repeat(60);

const { resolveProvider } = await import('../src/proxy.js');

describe('resolveProvider integration', () => {
  describe('body-based routing (new format)', () => {
    it('routes model aido/auto to auto', () => {
      const result = resolveProvider('/v1/chat/completions', '{"model":"aido/auto"}');
      expect(result.provider).toBe('auto');
      expect(result.isAidoAuto).toBe(true);
    });

    it('routes model aido/cloud to zen (default cloud)', () => {
      const result = resolveProvider('/v1/chat/completions', '{"model":"aido/cloud"}');
      expect(result.provider).toBe('zen');
      expect(result.isAidoAuto).toBe(true);
    });

    it('routes model aido/cloud/big-pickle to zen with model', () => {
      const result = resolveProvider('/v1/chat/completions', '{"model":"aido/cloud/big-pickle"}');
      expect(result.provider).toBe('zen');
      expect(result.model).toBe('big-pickle');
      expect(result.isAidoAuto).toBe(true);
    });

    it('routes model aido/local to ollama-local', () => {
      const result = resolveProvider('/v1/chat/completions', '{"model":"aido/local"}');
      expect(result.provider).toBe('ollama-local');
      expect(result.isAidoAuto).toBe(true);
    });

    it('routes model aido/local/qwen3:8b to ollama-local with model', () => {
      const result = resolveProvider('/v1/chat/completions', '{"model":"aido/local/qwen3:8b"}');
      expect(result.provider).toBe('ollama-local');
      expect(result.model).toBe('qwen3:8b');
      expect(result.isAidoAuto).toBe(false);
    });

    it('routes model aido/zen/big-pickle to zen', () => {
      const result = resolveProvider('/v1/chat/completions', '{"model":"aido/zen/big-pickle"}');
      expect(result.provider).toBe('zen');
      expect(result.model).toBe('big-pickle');
      expect(result.isAidoAuto).toBe(false);
    });

    it('routes model aido/ollama/glm-5:cloud to ollama', () => {
      const result = resolveProvider('/v1/chat/completions', '{"model":"aido/ollama/glm-5:cloud"}');
      expect(result.provider).toBe('ollama');
      expect(result.model).toBe('glm-5:cloud');
      expect(result.isAidoAuto).toBe(false);
    });

    it('routes model aido/openai/gpt-4o-mini to openai', () => {
      const result = resolveProvider('/v1/chat/completions', '{"model":"aido/openai/gpt-4o-mini"}');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o-mini');
      expect(result.isAidoAuto).toBe(false);
    });

    it('routes model aido/groq/llama3-8b-8192 to groq', () => {
      const result = resolveProvider('/v1/chat/completions', '{"model":"aido/groq/llama3-8b-8192"}');
      expect(result.provider).toBe('groq');
      expect(result.model).toBe('llama3-8b-8192');
      expect(result.isAidoAuto).toBe(false);
    });

    it('routes model aido/anthropic/claude-haiku-4-5 to anthropic', () => {
      const result = resolveProvider('/v1/chat/completions', '{"model":"aido/anthropic/claude-haiku-4-5"}');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-haiku-4-5');
      expect(result.isAidoAuto).toBe(false);
    });
  });

  describe('default behavior (no model in body)', () => {
    it('routes /v1/chat/completions without body to default provider (zen)', () => {
      const result = resolveProvider('/v1/chat/completions');
      expect(result.provider).toBe('zen');
    });

    it('routes /v1/chat/completions with empty body to default provider (zen)', () => {
      const result = resolveProvider('/v1/chat/completions', '');
      expect(result.provider).toBe('zen');
    });

    it('routes /v1/chat/completions with non-model JSON to default provider (zen)', () => {
      const result = resolveProvider('/v1/chat/completions', '{"messages":[{"role":"user","content":"hi"}]}');
      expect(result.provider).toBe('zen');
    });
  });

  describe('error handling', () => {
    it('falls back to default for invalid model name', () => {
      const result = resolveProvider('/v1/chat/completions', '{"model":"aido/unknown/model"}');
      expect(result.provider).toBe('zen');
    });
  });
});
