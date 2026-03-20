import { describe, it, expect, beforeEach } from 'vitest';

process.env.DB_PATH = ':memory:';

const { resetDb, saveModels, getFreeModels, getDb } = await import('../src/db.js');

describe('db - models table', () => {
  beforeEach(() => {
    resetDb();
  });

  describe('saveModels', () => {
    it('saves a single free model with isFree=1', () => {
      const models = [{
        id: 'big-pickle',
        name: 'Big Pickle',
        provider: 'zen',
        isFree: true,
        discoveredAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      }];

      saveModels('zen', models);

      const db = getDb();
      const row = db
        .prepare('SELECT model_id, is_free FROM models WHERE provider = ? AND model_id = ?')
        .get('zen', 'big-pickle') as { model_id: string; is_free: number };

      expect(row).toBeDefined();
      expect(row.model_id).toBe('big-pickle');
      expect(row.is_free).toBe(1);
    });

    it('saves a single paid model with isFree=0', () => {
      const models = [{
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        isFree: false,
        discoveredAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      }];

      saveModels('openai', models);

      const db = getDb();
      const row = db
        .prepare('SELECT model_id, is_free FROM models WHERE provider = ? AND model_id = ?')
        .get('openai', 'gpt-4o') as { model_id: string; is_free: number };

      expect(row).toBeDefined();
      expect(row.model_id).toBe('gpt-4o');
      expect(row.is_free).toBe(0);
    });

    it('saves multiple models with correct isFree flags', () => {
      const models = [
        {
          id: 'big-pickle',
          name: 'Big Pickle',
          provider: 'zen',
          isFree: true,
          discoveredAt: Date.now(),
          expiresAt: Date.now() + 3600000,
        },
        {
          id: 'some-paid-model',
          name: 'Some Paid Model',
          provider: 'zen',
          isFree: false,
          discoveredAt: Date.now(),
          expiresAt: Date.now() + 3600000,
        },
      ];

      saveModels('zen', models);

      const db = getDb();
      const rows = db
        .prepare('SELECT model_id, is_free FROM models WHERE provider = ? ORDER BY model_id')
        .all('zen') as Array<{ model_id: string; is_free: number }>;

      expect(rows).toHaveLength(2);
      expect(rows[0].model_id).toBe('big-pickle');
      expect(rows[0].is_free).toBe(1);
      expect(rows[1].model_id).toBe('some-paid-model');
      expect(rows[1].is_free).toBe(0);
    });

    it('updates existing models with new isFree value', () => {
      const models = [{
        id: 'big-pickle',
        name: 'Big Pickle',
        provider: 'zen',
        isFree: true,
        discoveredAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      }];

      saveModels('zen', models);

      const updatedModels = [{
        id: 'big-pickle',
        name: 'Big Pickle',
        provider: 'zen',
        isFree: false,
        discoveredAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      }];

      saveModels('zen', updatedModels);

      const db = getDb();
      const row = db
        .prepare('SELECT is_free FROM models WHERE provider = ? AND model_id = ?')
        .get('zen', 'big-pickle') as { is_free: number };

      expect(row.is_free).toBe(0);
    });
  });

  describe('getFreeModels', () => {
    it('returns only models with isFree=1', () => {
      const db = getDb();

      db.prepare(`
        INSERT INTO models (provider, model_id, model_name, is_free, discovered_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)
      `).run(
        'zen', 'big-pickle', 'Big Pickle', 1, Date.now(), Date.now() + 3600000,
        'zen', 'some-paid-model', 'Some Paid Model', 0, Date.now(), Date.now() + 3600000,
      );

      const freeModels = getFreeModels('zen');

      expect(freeModels).toHaveLength(1);
      expect(freeModels[0].id).toBe('big-pickle');
      expect(freeModels[0].isFree).toBe(true);
    });

    it('returns empty array when no free models exist', () => {
      const db = getDb();

      db.prepare(`
        INSERT INTO models (provider, model_id, model_name, is_free, discovered_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('zen', 'some-paid-model', 'Some Paid Model', 0, Date.now(), Date.now() + 3600000);

      const freeModels = getFreeModels('zen');

      expect(freeModels).toHaveLength(0);
    });

    it('returns empty array when table is empty', () => {
      const freeModels = getFreeModels('zen');

      expect(freeModels).toHaveLength(0);
    });

    it('filters by provider', () => {
      const db = getDb();

      db.prepare(`
        INSERT INTO models (provider, model_id, model_name, is_free, discovered_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)
      `).run(
        'zen', 'big-pickle', 'Big Pickle', 1, Date.now(), Date.now() + 3600000,
        'openai', 'gpt-4o-mini', 'GPT-4o Mini', 1, Date.now(), Date.now() + 3600000,
      );

      const zenFreeModels = getFreeModels('zen');
      const openaiFreeModels = getFreeModels('openai');

      expect(zenFreeModels).toHaveLength(1);
      expect(zenFreeModels[0].id).toBe('big-pickle');
      expect(openaiFreeModels).toHaveLength(1);
      expect(openaiFreeModels[0].id).toBe('gpt-4o-mini');
    });

    it('filters out expired models', () => {
      const db = getDb();

      db.prepare(`
        INSERT INTO models (provider, model_id, model_name, is_free, discovered_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('zen', 'big-pickle', 'Big Pickle', 1, Date.now(), Date.now() - 1000);

      const freeModels = getFreeModels('zen');

      expect(freeModels).toHaveLength(0);
    });
  });
});
