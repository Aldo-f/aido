import { describe, it, expect, beforeEach } from 'vitest';

process.env.DB_PATH = ':memory:';

const { resetDb, markRateLimited } = await import('../src/db.js');
const { KeyRotator, resetRotators } = await import('../src/rotator.js');

beforeEach(() => {
  resetDb();
  resetRotators();
});

describe('KeyRotator', () => {
  it('returns null when no keys are configured', () => {
    const rotator = new KeyRotator('opencode', []);
    expect(rotator.next()).toBeNull();
  });

  it('returns the only key when one is available', () => {
    const rotator = new KeyRotator('opencode', ['sk-key1']);
    expect(rotator.next()).toBe('sk-key1');
  });

  it('cycles through multiple keys', () => {
    const rotator = new KeyRotator('opencode', ['sk-a', 'sk-b', 'sk-c']);
    expect(rotator.next()).toBe('sk-a');
    expect(rotator.next()).toBe('sk-b');
    expect(rotator.next()).toBe('sk-c');
    expect(rotator.next()).toBe('sk-a'); // wraps around
  });

  it('skips rate-limited keys', () => {
    const rotator = new KeyRotator('opencode', ['sk-a', 'sk-b', 'sk-c']);
    markRateLimited('sk-a', 'opencode', 3600);
    markRateLimited('sk-b', 'opencode', 3600);

    expect(rotator.next()).toBe('sk-c');
    expect(rotator.next()).toBe('sk-c'); // only available key
  });

  it('returns null when all keys are rate-limited', () => {
    const rotator = new KeyRotator('opencode', ['sk-a', 'sk-b']);
    markRateLimited('sk-a', 'opencode', 3600);
    markRateLimited('sk-b', 'opencode', 3600);

    expect(rotator.next()).toBeNull();
  });

  it('markLimited marks the key in db', () => {
    const rotator = new KeyRotator('opencode', ['sk-a', 'sk-b']);
    rotator.markLimited('sk-a');

    expect(rotator.next()).toBe('sk-b');
  });

  it('availableKeys returns only non-limited keys', () => {
    const rotator = new KeyRotator('opencode', ['sk-a', 'sk-b', 'sk-c']);
    markRateLimited('sk-b', 'opencode', 3600);

    expect(rotator.availableKeys()).toEqual(['sk-a', 'sk-c']);
  });

  it('count reflects total keys regardless of rate limiting', () => {
    const rotator = new KeyRotator('opencode', ['sk-a', 'sk-b', 'sk-c']);
    markRateLimited('sk-a', 'opencode', 3600);

    expect(rotator.count).toBe(3);
  });

  it('expired limits are treated as available', () => {
    const rotator = new KeyRotator('opencode', ['sk-a']);
    markRateLimited('sk-a', 'opencode', -1); // expired immediately

    expect(rotator.next()).toBe('sk-a');
  });

  it('markInvalidKey marks key with 30-day cooldown', () => {
    const rotator = new KeyRotator('opencode', ['sk-a', 'sk-b']);
    rotator.markInvalidKey('sk-a');

    expect(rotator.next()).toBe('sk-b');
  });

  it('markQuotaExceeded marks key with 90-day cooldown', () => {
    const rotator = new KeyRotator('opencode', ['sk-a', 'sk-b']);
    rotator.markQuotaExceeded('sk-a');

    expect(rotator.next()).toBe('sk-b');
  });
});
