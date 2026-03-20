// Uses built-in node:sqlite (Node.js v22.5+) — no native compilation needed
import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'aido.db');

let _db: DatabaseSync | null = null;

export function getDb(dbPath = DB_PATH): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(dbPath);
  _db.exec('PRAGMA journal_mode=WAL;');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      key         TEXT    PRIMARY KEY,
      provider    TEXT    NOT NULL,
      limited_until INTEGER NOT NULL,
      hit_count   INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS request_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      key       TEXT    NOT NULL,
      provider  TEXT    NOT NULL,
      status    INTEGER NOT NULL,
      ts        INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS searched_sources (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url  TEXT    NOT NULL UNIQUE,
      query       TEXT,
      searched_at INTEGER NOT NULL DEFAULT (unixepoch()),
      keys_found  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_searched_at ON searched_sources(searched_at);
     CREATE TABLE IF NOT EXISTS models (
       provider      TEXT    NOT NULL,
       model_id      TEXT    NOT NULL,
       model_name    TEXT    NOT NULL,
       is_free       INTEGER NOT NULL DEFAULT 0,
       discovered_at INTEGER NOT NULL,
       expires_at    INTEGER NOT NULL,
       PRIMARY KEY (provider, model_id)
     );
     CREATE INDEX IF NOT EXISTS idx_models_expires ON models(expires_at);
     CREATE INDEX IF NOT EXISTS idx_models_is_free ON models(is_free);
    CREATE TABLE IF NOT EXISTS model_limits (
      provider      TEXT    NOT NULL,
      model_id      TEXT    NOT NULL,
      limited_until INTEGER NOT NULL,
      PRIMARY KEY (provider, model_id)
    );
  `);

  try {
    _db.exec('ALTER TABLE request_log ADD COLUMN model TEXT NOT NULL DEFAULT ""');
  } catch {
    // Column may already exist
  }
  try {
    _db.exec('ALTER TABLE request_log ADD COLUMN source TEXT NOT NULL DEFAULT "proxy"');
  } catch {
    // Column may already exist
  }
  try {
    _db.exec('ALTER TABLE request_log ADD COLUMN latency_ms INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column may already exist
  }

  _db.exec('CREATE INDEX IF NOT EXISTS idx_request_log_model ON request_log(model)');
  _db.exec('CREATE INDEX IF NOT EXISTS idx_request_log_source ON request_log(source)');

  return _db;
}

/** Reset singleton — used in tests to get a fresh in-memory DB */
export function resetDb() {
  _db = null;
}

export function markRateLimited(
  key: string,
  provider: string,
  cooldownSeconds = 3600,
): void {
  const db = getDb();
  const until = Date.now() + cooldownSeconds * 1000;
  db.prepare(`
    INSERT INTO rate_limits (key, provider, limited_until, hit_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET
      limited_until = excluded.limited_until,
      hit_count = hit_count + 1
  `).run(key, provider, until);
}

export function isRateLimited(key: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT limited_until FROM rate_limits WHERE key = ?')
    .get(key) as { limited_until: number } | undefined;
  if (!row) return false;
  return row.limited_until > Date.now();
}

export function clearExpiredLimits(): number {
  const db = getDb();
  const now = Date.now();
  const result1 = db
    .prepare('DELETE FROM rate_limits WHERE limited_until <= ?')
    .run(now);
  const result2 = db
    .prepare('DELETE FROM model_limits WHERE limited_until <= ?')
    .run(now);
  return Number(result1.changes) + Number(result2.changes);
}

/** Mark a model as rate limited */
export function markModelRateLimited(
  provider: string,
  modelId: string,
  cooldownSeconds = 3600,
): void {
  const db = getDb();
  const until = Date.now() + cooldownSeconds * 1000;
  db.prepare(`
    INSERT INTO model_limits (provider, model_id, limited_until)
    VALUES (?, ?, ?)
    ON CONFLICT(provider, model_id) DO UPDATE SET
      limited_until = excluded.limited_until
  `).run(provider, modelId, until);
}

/** Check if a model is rate limited */
export function isModelRateLimited(provider: string, modelId: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT limited_until FROM model_limits WHERE provider = ? AND model_id = ?')
    .get(provider, modelId) as { limited_until: number } | undefined;
  if (!row) return false;
  return row.limited_until > Date.now();
}

/** Clear model rate limit */
export function clearModelRateLimit(provider: string, modelId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM model_limits WHERE provider = ? AND model_id = ?')
    .run(provider, modelId);
}

/** Get all rate-limited models */
export function getRateLimitedModels(): Array<{ provider: string; model_id: string; limited_until: number }> {
  const db = getDb();
  return db
    .prepare('SELECT provider, model_id, limited_until FROM model_limits WHERE limited_until > ?')
    .all(Date.now()) as Array<{ provider: string; model_id: string; limited_until: number }>;
}

export function clearAllLimits(): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM rate_limits').run();
  return Number(result.changes);
}

export function clearAllModelLimits(): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM model_limits').run();
  return Number(result.changes);
}

export function logRequest(
  key: string,
  provider: string,
  status: number,
  model?: string,
  source?: 'run' | 'proxy',
  latencyMs?: number,
): void {
  const db = getDb();
  db.prepare('INSERT INTO request_log (key, provider, status, model, source, latency_ms) VALUES (?, ?, ?, ?, ?, ?)')
    .run(key, provider, status, model ?? '', source ?? 'proxy', latencyMs ?? 0);
}

export function getRateLimitedKeys(): Array<{ key: string; provider: string; limited_until: number }> {
  const db = getDb();
  return db
    .prepare('SELECT key, provider, limited_until FROM rate_limits WHERE limited_until > ?')
    .all(Date.now()) as Array<{ key: string; provider: string; limited_until: number }>;
}

export function markSourceSearched(url: string, query: string, keysFound: number): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO searched_sources (source_url, query, keys_found)
    VALUES (?, ?, ?)
    ON CONFLICT(source_url) DO UPDATE SET
      searched_at = unixepoch(),
      keys_found = excluded.keys_found
  `).run(url, query, keysFound);
}

export function isSourceSearchedRecently(url: string, hoursOld = 24): boolean {
  const db = getDb();
  const cutoff = Date.now() - hoursOld * 60 * 60 * 1000;
  const row = db
    .prepare('SELECT searched_at FROM searched_sources WHERE source_url = ? AND searched_at * 1000 > ?')
    .get(url, cutoff) as { searched_at: number } | undefined;
  return !!row;
}

export function getRecentlySearchedUrls(hoursOld = 24): Set<string> {
  const db = getDb();
  const cutoff = Date.now() - hoursOld * 60 * 60 * 1000;
  const rows = db
    .prepare('SELECT source_url FROM searched_sources WHERE searched_at * 1000 > ?')
    .all(cutoff) as Array<{ source_url: string }>;
  return new Set(rows.map(r => r.source_url));
}

export function cleanOldSearchedSources(daysOld = 7): number {
  const db = getDb();
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  const result = db
    .prepare('DELETE FROM searched_sources WHERE searched_at * 1000 < ?')
    .run(cutoff);
  return Number(result.changes);
}
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  isFree: boolean;
  discoveredAt: number;
  expiresAt: number;
}

export type FreeModel = ModelInfo;

export function saveModels(provider: string, models: ModelInfo[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO models (provider, model_id, model_name, is_free, discovered_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, model_id) DO UPDATE SET
      model_name = excluded.model_name,
      is_free = excluded.is_free,
      discovered_at = excluded.discovered_at,
      expires_at = excluded.expires_at
  `);
  
  for (const model of models) {
    const isFreeInt = model.isFree ? 1 : 0;
    stmt.run(provider, model.id, model.name, isFreeInt, model.discoveredAt, model.expiresAt);
  }
}

export function getModel(provider: string, modelId: string): ModelInfo | null {
  const db = getDb();
  const now = Date.now();
  const row = db
    .prepare('SELECT provider, model_id, model_name, is_free, discovered_at, expires_at FROM models WHERE provider = ? AND model_id = ? AND expires_at > ?')
    .get(provider, modelId, now) as { provider: string; model_id: string; model_name: string; is_free: number; discovered_at: number; expires_at: number } | undefined;
  
  if (!row) return null;
  
  return {
    id: row.model_id,
    name: row.model_name,
    provider: row.provider,
    isFree: row.is_free === 1,
    discoveredAt: row.discovered_at,
    expiresAt: row.expires_at,
  };
}

export function getAllModels(provider: string): ModelInfo[] {
  const db = getDb();
  const now = Date.now();
  const rows = db
    .prepare('SELECT provider, model_id, model_name, is_free, discovered_at, expires_at FROM models WHERE provider = ? AND expires_at > ?')
    .all(provider, now) as Array<{ provider: string; model_id: string; model_name: string; is_free: number; discovered_at: number; expires_at: number }>;
   
  return rows.map(row => ({
    id: row.model_id,
    name: row.model_name,
    provider: row.provider,
    isFree: row.is_free === 1,
    discoveredAt: row.discovered_at,
    expiresAt: row.expires_at,
  }));
}

export function getFreeModels(provider: string): ModelInfo[] {
  const db = getDb();
  const now = Date.now();
  const rows = db
    .prepare('SELECT provider, model_id, model_name, is_free, discovered_at, expires_at FROM models WHERE provider = ? AND expires_at > ? AND is_free = 1')
    .all(provider, now) as Array<{ provider: string; model_id: string; model_name: string; is_free: number; discovered_at: number; expires_at: number }>;
   
  return rows.map(row => ({
    id: row.model_id,
    name: row.model_name,
    provider: row.provider,
    isFree: row.is_free === 1,
    discoveredAt: row.discovered_at,
    expiresAt: row.expires_at,
  }));
}

export function invalidateCache(provider?: string): number {
  const db = getDb();
  const now = Date.now();
  
  if (provider) {
    const result = db
      .prepare('DELETE FROM models WHERE provider = ? AND expires_at <= ?')
      .run(provider, now);
    return Number(result.changes);
  } else {
    const result = db
      .prepare('DELETE FROM models WHERE expires_at <= ?')
      .run(now);
    return Number(result.changes);
  }
}
