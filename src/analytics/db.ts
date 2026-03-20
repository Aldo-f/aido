import { getDb } from '../db.js';

export interface RequestLog {
  id: number;
  key: string;
  provider: string;
  status: number;
  model: string;
  source: 'run' | 'proxy';
  latencyMs: number;
  ts: number;
}

export interface ModelStats {
  model: string;
  count: number;
  successCount: number;
  failureCount: number;
  avgLatency: number;
}

export interface ProviderStats {
  provider: string;
  count: number;
  successCount: number;
  failureCount: number;
}

export interface SourceStats {
  source: 'run' | 'proxy';
  count: number;
  successCount: number;
  failureCount: number;
}

export function getTotalRequests(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM request_log').get() as { count: number };
  return row.count;
}

export function getRequestsByModel(): ModelStats[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT 
      model,
      COUNT(*) as count,
      SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as successCount,
      SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) as failureCount,
      AVG(CASE WHEN latency_ms > 0 THEN latency_ms ELSE NULL END) as avgLatency
    FROM request_log
    WHERE model != ''
    GROUP BY model
    ORDER BY count DESC
  `).all() as Array<{
    model: string;
    count: number;
    successCount: number;
    failureCount: number;
    avgLatency: number | null;
  }>;

  return rows.map(row => ({
    model: row.model,
    count: row.count,
    successCount: row.successCount,
    failureCount: row.failureCount,
    avgLatency: row.avgLatency ?? 0,
  }));
}

export function getRequestsByProvider(): ProviderStats[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT 
      provider,
      COUNT(*) as count,
      SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as successCount,
      SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) as failureCount
    FROM request_log
    GROUP BY provider
    ORDER BY count DESC
  `).all() as Array<{
    provider: string;
    count: number;
    successCount: number;
    failureCount: number;
  }>;

  return rows.map(row => ({
    provider: row.provider,
    count: row.count,
    successCount: row.successCount,
    failureCount: row.failureCount,
  }));
}

export function getRequestsBySource(): SourceStats[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT 
      source,
      COUNT(*) as count,
      SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as successCount,
      SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) as failureCount
    FROM request_log
    GROUP BY source
    ORDER BY count DESC
  `).all() as Array<{
    source: string;
    count: number;
    successCount: number;
    failureCount: number;
  }>;

  return rows.map(row => ({
    source: row.source as 'run' | 'proxy',
    count: row.count,
    successCount: row.successCount,
    failureCount: row.failureCount,
  }));
}

export function getRecentLogs(limit = 50): RequestLog[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, key, provider, status, model, source, latency_ms, ts
    FROM request_log
    ORDER BY ts DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number;
    key: string;
    provider: string;
    status: number;
    model: string;
    source: string;
    latency_ms: number;
    ts: number;
  }>;

  return rows.map(row => ({
    id: row.id,
    key: row.key,
    provider: row.provider,
    status: row.status,
    model: row.model,
    source: row.source as 'run' | 'proxy',
    latencyMs: row.latency_ms,
    ts: row.ts,
  }));
}

export function getSuccessRate(): number {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as count FROM request_log').get() as { count: number };
  if (total.count === 0) return 0;

  const success = db.prepare('SELECT COUNT(*) as count FROM request_log WHERE status >= 200 AND status < 400').get() as { count: number };
  return Math.round((success.count / total.count) * 100);
}

export function getAvgLatency(): number {
  const db = getDb();
  const row = db.prepare('SELECT AVG(latency_ms) as avg FROM request_log WHERE latency_ms > 0').get() as { avg: number | null };
  return Math.round(row.avg ?? 0);
}
