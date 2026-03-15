// Uses built-in node:sqlite (Node.js v22.5+) — no native compilation needed
import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'aido.db');

let _db: DatabaseSync | null = null;

export function getDb(dbPath = DB_PATH): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(dbPath);
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
  `);
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
  const result = db
    .prepare('DELETE FROM rate_limits WHERE limited_until <= ?')
    .run(Date.now());
  return Number(result.changes);
}

export function clearAllLimits(): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM rate_limits').run();
  return Number(result.changes);
}

export function logRequest(key: string, provider: string, status: number): void {
  const db = getDb();
  db.prepare('INSERT INTO request_log (key, provider, status) VALUES (?, ?, ?)')
    .run(key, provider, status);
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
