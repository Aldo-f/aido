import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const { readEnvFile, writeEnvFile, addKeyToEnv } = await import('../src/env.js');

const TMP = path.join(os.tmpdir(), `aido-test-${Date.now()}.env`);

beforeEach(() => {
  if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
});
afterEach(() => {
  if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
});

describe('readEnvFile', () => {
  it('returns empty map for missing file', () => {
    const map = readEnvFile('/nonexistent/.env');
    expect(map.size).toBe(0);
  });

  it('parses key=value pairs', () => {
    fs.writeFileSync(TMP, 'FOO=bar\nBAZ=qux\n');
    const map = readEnvFile(TMP);
    expect(map.get('FOO')).toBe('bar');
    expect(map.get('BAZ')).toBe('qux');
  });

  it('ignores comments and blank lines', () => {
    fs.writeFileSync(TMP, '# comment\n\nFOO=bar\n');
    const map = readEnvFile(TMP);
    expect(map.size).toBe(1);
  });
});

describe('addKeyToEnv', () => {
  it('creates .env with first key', () => {
    const result = addKeyToEnv('zen', 'sk-key1', TMP);
    expect(result.added).toBe(true);
    expect(result.total).toBe(1);

    const map = readEnvFile(TMP);
    expect(map.get('ZEN_KEYS')).toBe('sk-key1');
  });

  it('appends a second key', () => {
    addKeyToEnv('zen', 'sk-key1', TMP);
    const result = addKeyToEnv('zen', 'sk-key2', TMP);

    expect(result.added).toBe(true);
    expect(result.total).toBe(2);

    const map = readEnvFile(TMP);
    expect(map.get('ZEN_KEYS')).toBe('sk-key1,sk-key2');
  });

  it('does not duplicate an existing key', () => {
    addKeyToEnv('zen', 'sk-key1', TMP);
    const result = addKeyToEnv('zen', 'sk-key1', TMP);

    expect(result.added).toBe(false);
    expect(result.total).toBe(1);
  });

  it('handles multiple providers independently', () => {
    addKeyToEnv('zen', 'sk-zen-key1', TMP);
    addKeyToEnv('openai', 'sk-proj-key1', TMP);

    const map = readEnvFile(TMP);
    expect(map.get('ZEN_KEYS')).toBe('sk-zen-key1');
    expect(map.get('OPENAI_KEYS')).toBe('sk-proj-key1');
  });
});
