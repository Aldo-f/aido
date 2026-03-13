import { describe, it, expect } from 'vitest';
import { detectProvider } from '../src/detector.js';

describe('detectProvider', () => {
  it('detects Anthropic keys', () => {
    expect(detectProvider('sk-ant-api03-abc123')).toBe('anthropic');
  });

  it('detects OpenAI project keys', () => {
    expect(detectProvider('sk-proj-abcdefghij')).toBe('openai');
  });

  it('detects Groq keys', () => {
    expect(detectProvider('gsk_abc123xyz')).toBe('groq');
  });

  it('detects Google keys', () => {
    expect(detectProvider('AIzaSyAbc123')).toBe('google');
  });

  it('detects Zen keys (sk- prefix, 60+ chars)', () => {
    const zenKey = 'sk-LXREfPN2uSYZ74VW4HLpKpHbnhaW6JC6v87XFurX1FJnbcHed3EYlJUmNO5gooTF';
    expect(detectProvider(zenKey)).toBe('zen');
    expect(zenKey.length).toBeGreaterThanOrEqual(60);
  });

  it('detects short sk- keys as OpenAI (legacy)', () => {
    expect(detectProvider('sk-abcdefghijklmnopqrstuvwxyz123456789012345678')).toBe('openai');
  });

  it('detects Ollama Cloud keys (32 hex + . + alphanumeric)', () => {
    expect(detectProvider('3f7240e1a93345f0b7f91315c3860be7.qhdTl48Vsx7imv_9p52tcAtO')).toBe('ollama');
    expect(detectProvider('aabbccdd1122334455667788aabbccdd.someRandomSuffix')).toBe('ollama');
  });

  it('does not mis-detect non-Ollama keys as Ollama', () => {
    expect(detectProvider('sk-ant-api03-abc123')).not.toBe('ollama');
    expect(detectProvider('3f7240e1a93345f0b7f91315c3860be7')).toBeNull(); // no dot suffix
    expect(detectProvider('notahexstring12345678901234567890.suffix')).toBeNull(); // not hex
  });

  it('returns null for unknown keys', () => {
    expect(detectProvider('unknown-key-format')).toBeNull();
    expect(detectProvider('')).toBeNull();
    expect(detectProvider('Bearer xyz')).toBeNull();
  });

  it('Zen key is not mistaken for OpenAI', () => {
    const zenKey = 'sk-' + 'Z'.repeat(65);
    expect(detectProvider(zenKey)).toBe('zen');
  });

  it('OpenAI key (short) is not mistaken for Zen', () => {
    const openaiKey = 'sk-' + 'A'.repeat(30);
    expect(detectProvider(openaiKey)).toBe('openai');
  });
});
