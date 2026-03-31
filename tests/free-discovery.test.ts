import { describe, it, expect } from 'vitest';
import { identifyFreeModels } from '../src/free-discovery.js';
import type { RawModel } from '../src/free-discovery.js';

describe('identifyFreeModels', () => {
  describe('opencode provider', () => {
    it('identifies models ending with -free as free', () => {
      const models: RawModel[] = [
        { id: 'mimo-v2-flash-free' },
        { id: 'nemotron-3-super-free' },
        { id: 'minimax-m2.5-free' },
      ];
      const result = identifyFreeModels('opencode', models);
      expect(result.every(m => m.isFree)).toBe(true);
    });

    it('identifies big-pickle as free', () => {
      // big-pickle is a special case - doesn't end with -free but is documented as free
      const models: RawModel[] = [{ id: 'big-pickle' }];
      const result = identifyFreeModels('opencode', models);
      expect(result[0].isFree).toBe(true);
    });

    it('identifies paid models as not free', () => {
      const models: RawModel[] = [
        { id: 'some-paid-model' },
        { id: 'gpt-4' },
      ];
      const result = identifyFreeModels('opencode', models);
      expect(result.every(m => !m.isFree)).toBe(true);
    });

    it('preserves model metadata', () => {
      const models: RawModel[] = [
        { id: 'test-free', name: 'Test Model' },
      ];
      const result = identifyFreeModels('opencode', models);
      expect(result[0].id).toBe('test-free');
      expect(result[0].name).toBe('Test Model');
      expect(result[0].provider).toBe('opencode');
      expect(result[0].discoveredAt).toBeDefined();
      expect(result[0].expiresAt).toBeGreaterThan(result[0].discoveredAt);
    });
  });

  describe('OpenRouter provider', () => {
    it('identifies models ending with :free as free', () => {
      const models: RawModel[] = [
        { id: 'nvidia/nemotron-3-super-120b-a12b:free' },
        { id: 'openrouter/hunter-alpha:free' },
        { id: 'openrouter/healer-alpha:free' },
      ];
      const result = identifyFreeModels('openrouter', models);
      expect(result.every(m => m.isFree)).toBe(true);
    });

    it('identifies paid models as not free', () => {
      const models: RawModel[] = [
        { id: 'openrouter/hunter-alpha' },
        { id: 'anthropic/claude-3.5-sonnet' },
      ];
      const result = identifyFreeModels('openrouter', models);
      expect(result.every(m => !m.isFree)).toBe(true);
    });
  });

  describe('Google provider', () => {
    it('identifies Gemini Flash models as free', () => {
      const models: RawModel[] = [
        { id: 'gemini-1.5-flash' },
        { id: 'gemini-2.0-flash' },
        { id: 'gemini-1.5-flash-lite' },
      ];
      const result = identifyFreeModels('google', models);
      expect(result.every(m => m.isFree)).toBe(true);
    });

    it('identifies experimental models as free', () => {
      const models: RawModel[] = [
        { id: 'gemini-exp-1206' },
        { id: 'gemini-exp' },
      ];
      const result = identifyFreeModels('google', models);
      expect(result.every(m => m.isFree)).toBe(true);
    });

    it('identifies Pro models as not free', () => {
      const models: RawModel[] = [
        { id: 'gemini-1.5-pro' },
        { id: 'gemini-2.0-pro' },
      ];
      const result = identifyFreeModels('google', models);
      expect(result.every(m => !m.isFree)).toBe(true);
    });
  });

  describe('Groq provider', () => {
    it('identifies Llama models as free', () => {
      const models: RawModel[] = [
        { id: 'llama-3.1-8b-instant' },
        { id: 'llama-3.2-1b' },
        { id: 'llama-3.3-70b' },
      ];
      const result = identifyFreeModels('groq', models);
      expect(result.every(m => m.isFree)).toBe(true);
    });

    it('identifies Mixtral models as free', () => {
      const models: RawModel[] = [
        { id: 'mixtral-8x7b-32768' },
        { id: 'mixtral-8x22b' },
      ];
      const result = identifyFreeModels('groq', models);
      expect(result.every(m => m.isFree)).toBe(true);
    });

    it('identifies Gemma models as free', () => {
      const models: RawModel[] = [
        { id: 'gemma-7b-it' },
        { id: 'gemma2-9b-it' },
      ];
      const result = identifyFreeModels('groq', models);
      expect(result.every(m => m.isFree)).toBe(true);
    });

    it('identifies Qwen models as free', () => {
      const models: RawModel[] = [
        { id: 'qwen-2.5-72b-instruct' },
        { id: 'qwen-2.5-32b' },
      ];
      const result = identifyFreeModels('groq', models);
      expect(result.every(m => m.isFree)).toBe(true);
    });
  });

  describe('Ollama-local provider', () => {
    it('identifies all models as free', () => {
      const models: RawModel[] = [
        { id: 'llama3.2' },
        { id: 'codellama' },
        { id: 'mistral' },
      ];
      const result = identifyFreeModels('ollama-local', models);
      expect(result.every(m => m.isFree)).toBe(true);
    });
  });

  describe('Ollama provider (cloud)', () => {
    it('identifies all models as not free (unknown)', () => {
      const models: RawModel[] = [
        { id: 'llama3.2' },
        { id: 'codellama' },
      ];
      const result = identifyFreeModels('ollama', models);
      expect(result.every(m => !m.isFree)).toBe(true);
    });
  });

  describe('OpenAI provider', () => {
    it('identifies all models as not free', () => {
      const models: RawModel[] = [
        { id: 'gpt-4o' },
        { id: 'gpt-4o-mini' },
        { id: 'gpt-4-turbo' },
      ];
      const result = identifyFreeModels('openai', models);
      expect(result.every(m => !m.isFree)).toBe(true);
    });
  });

  describe('Anthropic provider', () => {
    it('identifies all models as not free', () => {
      const models: RawModel[] = [
        { id: 'claude-3-5-sonnet-20241022' },
        { id: 'claude-3-opus' },
      ];
      const result = identifyFreeModels('anthropic', models);
      expect(result.every(m => !m.isFree)).toBe(true);
    });
  });

  describe('mixed provider data', () => {
    it('correctly identifies free vs paid in mixed dataset', () => {
      const models: RawModel[] = [
        { id: 'gemini-1.5-flash', name: 'Gemini Flash' },
        { id: 'gemini-1.5-pro', name: 'Gemini Pro' },
        { id: 'gemini-exp-1206', name: 'Gemini Exp' },
      ];
      const result = identifyFreeModels('google', models);
      expect(result[0].isFree).toBe(true);
      expect(result[1].isFree).toBe(false);
      expect(result[2].isFree).toBe(true);
    });
  });
});
