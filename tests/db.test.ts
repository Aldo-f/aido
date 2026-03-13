import { describe, it, expect, beforeEach } from 'vitest';

// Use in-memory DB for tests
process.env.DB_PATH = ':memory:';

const { getDb, resetDb, markRateLimited, isRateLimited, clearExpiredLimits, logRequest, getRateLimitedKeys } =
  await import('../src/db.js');

describe('db', () => {
  beforeEach(() => {
    resetDb();
  });

  describe('isRateLimited', () => {
    it('returns false for unknown key', () => {
      expect(isRateLimited('sk-unknown')).toBe(false);
    });

    it('returns true for a recently limited key', () => {
      markRateLimited('sk-test', 'zen', 3600);
      expect(isRateLimited('sk-test')).toBe(true);
    });

    it('returns false for an expired limit', () => {
      markRateLimited('sk-test', 'zen', -1); // expired 1 second ago
      expect(isRateLimited('sk-test')).toBe(false);
    });
  });

  describe('markRateLimited', () => {
    it('increments hit_count on repeated marks', () => {
      markRateLimited('sk-test', 'zen', 3600);
      markRateLimited('sk-test', 'zen', 3600);
      markRateLimited('sk-test', 'zen', 3600);

      const db = getDb();
      const row = db
        .prepare('SELECT hit_count FROM rate_limits WHERE key = ?')
        .get('sk-test') as { hit_count: number };
      expect(row.hit_count).toBe(3);
    });
  });

  describe('clearExpiredLimits', () => {
    it('removes expired entries and returns count', () => {
      markRateLimited('sk-expired', 'zen', -1);
      markRateLimited('sk-active', 'zen', 3600);

      const removed = clearExpiredLimits();
      expect(removed).toBe(1);
      expect(isRateLimited('sk-active')).toBe(true);
      expect(isRateLimited('sk-expired')).toBe(false);
    });
  });

  describe('logRequest', () => {
    it('writes to request_log', () => {
      logRequest('sk-test', 'zen', 200);
      logRequest('sk-test', 'zen', 429);

      const db = getDb();
      const rows = db
        .prepare('SELECT status FROM request_log WHERE key = ? ORDER BY id')
        .all('sk-test') as Array<{ status: number }>;
      expect(rows).toHaveLength(2);
      expect(rows[0].status).toBe(200);
      expect(rows[1].status).toBe(429);
    });
  });

  describe('getRateLimitedKeys', () => {
    it('returns only active limits', () => {
      markRateLimited('sk-a', 'zen', 3600);
      markRateLimited('sk-b', 'openai', -1); // expired

      const limited = getRateLimitedKeys();
      expect(limited).toHaveLength(1);
      expect(limited[0].key).toBe('sk-a');
    });
  });
});
