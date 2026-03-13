import { describe, it, expect } from 'vitest';
import { toOllamaPath, toOllamaBody, fromOllamaResponse } from '../src/ollama.js';

describe('Ollama path translation', () => {
  it('maps /v1/chat/completions → /api/chat', () => {
    expect(toOllamaPath('/v1/chat/completions')).toBe('/api/chat');
  });

  it('maps /v1/models → /api/tags', () => {
    expect(toOllamaPath('/v1/models')).toBe('/api/tags');
  });

  it('passes unknown paths through unchanged', () => {
    expect(toOllamaPath('/api/version')).toBe('/api/version');
  });
});

describe('Ollama request body translation', () => {
  it('converts OpenAI format to Ollama format', () => {
    const input = JSON.stringify({
      model: 'gpt-oss:20b',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7,
      stream: false,
    });
    const result = JSON.parse(toOllamaBody(input));
    expect(result.model).toBe('gpt-oss:20b');
    expect(result.messages).toHaveLength(1);
    expect(result.stream).toBe(false);
    expect(result.temperature).toBeUndefined();
  });

  it('defaults stream to false when not set', () => {
    const input = JSON.stringify({ model: 'gpt-oss:20b', messages: [] });
    const result = JSON.parse(toOllamaBody(input));
    expect(result.stream).toBe(false);
  });

  it('passes through invalid JSON unchanged', () => {
    expect(toOllamaBody('not json')).toBe('not json');
  });
});

describe('Ollama response translation', () => {
  it('converts Ollama chat response to OpenAI format', () => {
    const ollamaResponse = JSON.stringify({
      model: 'gpt-oss:20b',
      message: { role: 'assistant', content: 'Hello there!' },
      done: true,
    });
    const result = JSON.parse(fromOllamaResponse(ollamaResponse));
    expect(result.object).toBe('chat.completion');
    expect(result.choices[0].message.content).toBe('Hello there!');
    expect(result.choices[0].finish_reason).toBe('stop');
    expect(result.model).toBe('gpt-oss:20b');
  });

  it('passes through non-chat responses unchanged', () => {
    const tagsResponse = JSON.stringify({ models: [{ name: 'llama3' }] });
    expect(fromOllamaResponse(tagsResponse)).toBe(tagsResponse);
  });

  it('passes through invalid JSON unchanged', () => {
    expect(fromOllamaResponse('not json')).toBe('not json');
  });
});
