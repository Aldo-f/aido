import { describe, it, expect } from 'vitest';
import { mergeWithCapabilities, getModelCapabilities } from '../src/model-capabilities.js';

describe('model capabilities', () => {
  it('big-pickle has correct context limit', () => {
    const caps = mergeWithCapabilities('big-pickle');
    
    expect(caps).toEqual({
      context: 200000,
      input: 200000,
      output: 64000,
      allows: ['reasoning', 'text'],
    });
  });

  it('known models return capabilities from database', () => {
    expect(getModelCapabilities('big-pickle')).not.toBeNull();
    expect(getModelCapabilities('claude-3-5-haiku')).not.toBeNull();
    expect(getModelCapabilities('gemini-3-flash')).not.toBeNull();
    expect(getModelCapabilities('mimo-v2-flash-free')).not.toBeNull();
  });

  it('unknown models get default fallback capabilities', () => {
    const caps = mergeWithCapabilities('unknown-model-xyz');
    
    expect(caps.context).toBe(200000);
    expect(caps.output).toBe(64000);
    expect(caps.allows).toContain('text');
  });

  it('context limit is returned in /v1/models response', () => {
    const apiResponse = JSON.stringify({
      object: 'list',
      data: [
        { id: 'big-pickle', owned_by: 'opencode' },
        { id: 'claude-3-5-haiku', owned_by: 'opencode' },
      ],
    });

    const enriched = (() => {
      const json = JSON.parse(apiResponse);
      json.data = json.data.map((m: { id: string }) => ({
        ...m,
        capabilities: mergeWithCapabilities(m.id),
      }));
      return JSON.stringify(json);
    })();

    const parsed = JSON.parse(enriched);
    expect(parsed.data[0].capabilities.context).toBe(200000);
    expect(parsed.data[1].capabilities.context).toBe(200000);
  });
});
