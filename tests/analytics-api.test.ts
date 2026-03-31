import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';

process.env.DB_PATH = ':memory:';

const { resetDb, logRequest } = await import('../src/db.js');

let startAnalyticsServer: (port: number) => http.Server;

describe('analytics API', () => {
  let server: http.Server;
  const PORT = 14142;

  beforeEach(async () => {
    resetDb();
    const mod = await import('../src/analytics/api.js');
    startAnalyticsServer = mod.startAnalyticsServer;
    server = startAnalyticsServer(PORT);
    await new Promise(r => setTimeout(r, 100));
  });

  afterEach(() => {
    server.close();
  });

  it('GET /api/stats returns correct structure', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/stats`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('totalRequests');
    expect(data).toHaveProperty('successRate');
    expect(data).toHaveProperty('avgLatency');
  });

  it('GET /api/models returns array', async () => {
    logRequest('sk-test', 'opencode', 200, 'test-model');
    const res = await fetch(`http://localhost:${PORT}/api/models`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/logs returns array', async () => {
    logRequest('sk-test', 'opencode', 200);
    const res = await fetch(`http://localhost:${PORT}/api/logs`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/providers returns array', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/providers`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/sources returns array', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/sources`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/unknown`);
    expect(res.status).toBe(404);
  });

  it('GET /api/logs respects limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      logRequest(`sk-${i}`, 'opencode', 200);
    }
    const res = await fetch(`http://localhost:${PORT}/api/logs?limit=5`);
    const data = await res.json();
    expect(data).toHaveLength(5);
  });

  it('sets correct CORS headers', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/stats`);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('GET / returns HTML content', async () => {
    const res = await fetch(`http://localhost:${PORT}/`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get('Content-Type');
    expect(contentType).toContain('text/html');
  });
});
