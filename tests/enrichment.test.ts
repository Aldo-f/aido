import { describe, it, expect } from 'vitest';
import { mergeWithCapabilities } from '../src/model-capabilities.js';

function enrichModelsWithCapabilities(responseBody: string): string {
  try {
    const json = JSON.parse(responseBody);
    const models = json.data ?? [];
    if (Array.isArray(models) && models.length > 0) {
      json.data = models.map((m: { id: string }) => ({
        ...m,
        capabilities: mergeWithCapabilities(m.id),
      }));
      return JSON.stringify(json);
    }
    return responseBody;
  } catch {
    return responseBody;
  }
}

describe('enrichModelsWithCapabilities', () => {
  it('adds capabilities to models', () => {
    const response = JSON.stringify({
      object: 'list',
      data: [
        { id: 'big-pickle', owned_by: 'opencode' },
        { id: 'gpt-4', owned_by: 'openai' },
      ],
    });

    const enriched = enrichModelsWithCapabilities(response);
    const parsed = JSON.parse(enriched);

    expect(parsed.data[0].capabilities).toEqual({
      context: 200000,
      input: 200000,
      output: 64000,
      allows: ['reasoning', 'text'],
    });

    expect(parsed.data[1].capabilities).toEqual({
      context: 200000,
      input: 200000,
      output: 64000,
      allows: ['text'],
    });
  });

  it('returns original on invalid JSON', () => {
    const response = 'not json';
    const enriched = enrichModelsWithCapabilities(response);
    expect(enriched).toBe(response);
  });

  it('returns original when no data array', () => {
    const response = JSON.stringify({ error: 'something' });
    const enriched = enrichModelsWithCapabilities(response);
    expect(enriched).toBe(response);
  });
});
