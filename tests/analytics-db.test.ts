import { describe, it, expect, beforeEach } from 'vitest';

// Use in-memory DB for tests
process.env.DB_PATH = ':memory:';

// Import from db.ts for resetDb and logRequest
const { resetDb, logRequest } = await import('../src/db.js');

// These will be imported from src/analytics/db.ts after Phase 2
import type {
  RequestLog,
  ModelStats,
  ProviderStats,
  SourceStats,
} from '../src/analytics/db.js';

let getTotalRequests: () => number;
let getRequestsByModel: () => ModelStats[];
let getRequestsByProvider: () => ProviderStats[];
let getRequestsBySource: () => SourceStats[];
let getRecentLogs: (limit?: number) => RequestLog[];
let getSuccessRate: () => number;
let getAvgLatency: () => number;

describe('analytics-db', () => {
  beforeEach(async () => {
    resetDb();
    const mod = await import('../src/analytics/db.js');
    getTotalRequests = mod.getTotalRequests;
    getRequestsByModel = mod.getRequestsByModel;
    getRequestsByProvider = mod.getRequestsByProvider;
    getRequestsBySource = mod.getRequestsBySource;
    getRecentLogs = mod.getRecentLogs;
    getSuccessRate = mod.getSuccessRate;
    getAvgLatency = mod.getAvgLatency;
  });

  describe('getTotalRequests', () => {
    it('returns 0 for empty database', () => {
      expect(getTotalRequests()).toBe(0);
    });

    it('returns correct count after logging requests', () => {
      logRequest('sk-test', 'zen', 200);
      logRequest('sk-test', 'zen', 200);
      logRequest('sk-test', 'zen', 429);
      expect(getTotalRequests()).toBe(3);
    });
  });

  describe('getRequestsByModel', () => {
    it('returns empty array for no data', () => {
      expect(getRequestsByModel()).toEqual([]);
    });

    it('groups requests by model', () => {
      logRequest('sk-test', 'zen', 200, 'big-pickle');
      logRequest('sk-test', 'zen', 200, 'big-pickle');
      logRequest('sk-test', 'zen', 429, 'mimo-v2-flash-free');

      const stats = getRequestsByModel();
      expect(stats).toHaveLength(2);

      const bigPickle = stats.find((s) => s.model === 'big-pickle');
      expect(bigPickle?.count).toBe(2);
      expect(bigPickle?.successCount).toBe(2);
      expect(bigPickle?.failureCount).toBe(0);

      const mimo = stats.find((s) => s.model === 'mimo-v2-flash-free');
      expect(mimo?.count).toBe(1);
      expect(mimo?.failureCount).toBe(1);
    });

    it('calculates avg latency per model', () => {
      logRequest('sk-test', 'zen', 200, 'test-model', 'proxy', 100);
      logRequest('sk-test', 'zen', 200, 'test-model', 'proxy', 200);

      const stats = getRequestsByModel();
      const model = stats.find((s) => s.model === 'test-model');
      expect(model?.avgLatency).toBe(150);
    });
  });

  describe('getRequestsByProvider', () => {
    it('returns empty array for no data', () => {
      expect(getRequestsByProvider()).toEqual([]);
    });

    it('groups requests by provider', () => {
      logRequest('sk-test', 'zen', 200, 'a');
      logRequest('sk-test', 'openai', 200, 'b');

      const stats = getRequestsByProvider();
      expect(stats).toHaveLength(2);

      const zen = stats.find((s) => s.provider === 'zen');
      expect(zen?.count).toBe(1);

      const openai = stats.find((s) => s.provider === 'openai');
      expect(openai?.count).toBe(1);
    });
  });

  describe('getRequestsBySource', () => {
    it('returns empty array for no data', () => {
      expect(getRequestsBySource()).toEqual([]);
    });

    it('groups requests by source (run vs proxy)', () => {
      logRequest('sk-test', 'zen', 200, 'a', 'run', 100);
      logRequest('sk-test', 'zen', 200, 'b', 'proxy', 200);
      logRequest('sk-test', 'zen', 200, 'c', 'proxy', 300);

      const stats = getRequestsBySource();
      expect(stats).toHaveLength(2);

      const run = stats.find((s) => s.source === 'run');
      expect(run?.count).toBe(1);

      const proxy = stats.find((s) => s.source === 'proxy');
      expect(proxy?.count).toBe(2);
    });
  });

  describe('getRecentLogs', () => {
    it('returns empty array for no data', () => {
      expect(getRecentLogs()).toEqual([]);
    });

    it('returns logs in descending order by timestamp', async () => {
      const db = await import('../src/db.js');
      const getDb = db.getDb;
      
      getDb().prepare('INSERT INTO request_log (key, provider, status, model, source, latency_ms, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('sk-a', 'zen', 200, 'a', 'proxy', 100, 1000);
      getDb().prepare('INSERT INTO request_log (key, provider, status, model, source, latency_ms, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('sk-b', 'zen', 200, 'b', 'run', 200, 2000);

      const logs = getRecentLogs(10);
      expect(logs[0].model).toBe('b');
      expect(logs[1].model).toBe('a');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 100; i++) {
        logRequest(`sk-${i}`, 'zen', 200, `model-${i}`);
      }

      const logs = getRecentLogs(5);
      expect(logs).toHaveLength(5);
    });

    it('uses default limit of 50', () => {
      for (let i = 0; i < 60; i++) {
        logRequest(`sk-${i}`, 'zen', 200);
      }

      const logs = getRecentLogs();
      expect(logs).toHaveLength(50);
    });
  });

  describe('getSuccessRate', () => {
    it('returns 0 for no requests', () => {
      expect(getSuccessRate()).toBe(0);
    });

    it('returns 100 for all successful', () => {
      logRequest('sk-test', 'zen', 200);
      logRequest('sk-test', 'zen', 200);
      expect(getSuccessRate()).toBe(100);
    });

    it('returns 0 for all failures', () => {
      logRequest('sk-test', 'zen', 429);
      logRequest('sk-test', 'zen', 500);
      expect(getSuccessRate()).toBe(0);
    });

    it('calculates correct percentage for mixed', () => {
      logRequest('sk-test', 'zen', 200); // success
      logRequest('sk-test', 'zen', 429); // failure
      logRequest('sk-test', 'zen', 200); // success
      logRequest('sk-test', 'zen', 500); // failure
      expect(getSuccessRate()).toBe(50);
    });

    it('treats 2xx as success', () => {
      logRequest('sk-test', 'zen', 201);
      logRequest('sk-test', 'zen', 299);
      expect(getSuccessRate()).toBe(100);
    });
  });

  describe('getAvgLatency', () => {
    it('returns 0 for no latency data', () => {
      expect(getAvgLatency()).toBe(0);
    });

    it('returns 0 when all latency is 0', () => {
      logRequest('sk-test', 'zen', 200);
      expect(getAvgLatency()).toBe(0);
    });

    it('calculates correct average', () => {
      logRequest('sk-test', 'zen', 200, undefined, undefined, 100);
      logRequest('sk-test', 'zen', 200, undefined, undefined, 200);
      expect(getAvgLatency()).toBe(150);
    });

    it('ignores zero latency values', () => {
      logRequest('sk-test', 'zen', 200, undefined, undefined, 0);  // should be ignored
      logRequest('sk-test', 'zen', 200, undefined, undefined, 100);
      expect(getAvgLatency()).toBe(100);
    });
  });
});
