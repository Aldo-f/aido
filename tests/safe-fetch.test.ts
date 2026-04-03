import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { safeFetch } = await import('../src/safe-fetch.js');

describe('safeFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes timeout:false to fetch when called with url and init', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await safeFetch('https://example.com/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    // Should be called with (url, init) where init has timeout: false
    expect(callArgs[0]).toBe('https://example.com/api');
    expect((callArgs[1] as Record<string, unknown>).timeout).toBe(false);
    expect((callArgs[1] as RequestInit).method).toBe('POST');
    expect((callArgs[1] as RequestInit).body).toBe(JSON.stringify({ test: true }));
  });

  it('passes Request objects through to fetch without modification', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const req = new Request('https://example.com/api', {
      method: 'POST',
      body: JSON.stringify({ test: true }),
    });

    await safeFetch(req);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledReq = mockFetch.mock.calls[0][0] as Request;
    // Request is passed through as-is (no timeout modification)
    expect(calledReq).toBe(req);
    expect(calledReq.method).toBe('POST');
  });

  it('preserves all init options when calling fetch', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await safeFetch('https://example.com/api', {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer test-key',
        'X-Custom': 'value',
      },
      body: 'test body',
    });

    const callArgs = mockFetch.mock.calls[0];
    expect((callArgs[1] as RequestInit).method).toBe('PUT');
    expect((callArgs[1] as RequestInit).headers).toEqual({
      'Authorization': 'Bearer test-key',
      'X-Custom': 'value',
    });
    expect((callArgs[1] as RequestInit).body).toBe('test body');
  });

  it('retries on ETIMEDOUT network errors', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), {
        cause: { code: 'ETIMEDOUT' }
      }))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await safeFetch('https://example.com/api', { method: 'GET' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on ECONNREFUSED network errors', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), {
        cause: { code: 'ECONNREFUSED' }
      }))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await safeFetch('https://example.com/api', { method: 'GET' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on ENETUNREACH network errors', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), {
        cause: { code: 'ENETUNREACH' }
      }))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await safeFetch('https://example.com/api', { method: 'GET' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on generic fetch failed errors', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await safeFetch('https://example.com/api', { method: 'GET' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after max retries', async () => {
    const networkError = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ETIMEDOUT' }
    });
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(networkError)
      .mockRejectedValue(networkError)
      .mockRejectedValue(networkError)
      .mockRejectedValue(networkError);

    await expect(safeFetch('https://example.com/api', { method: 'GET' }))
      .rejects.toThrow('fetch failed');

    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('does not retry on non-network errors', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('Invalid URL'));

    await expect(safeFetch('https://example.com/api', { method: 'GET' }))
      .rejects.toThrow('Invalid URL');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry on HTTP error responses (4xx, 5xx)', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Not Found', { status: 404 }));

    const res = await safeFetch('https://example.com/api', { method: 'GET' });

    expect(res.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handles URL object as input', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const url = new URL('https://example.com/api');
    await safeFetch(url, { method: 'GET' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect((mockFetch.mock.calls[0][1] as Record<string, unknown>).timeout).toBe(false);
  });

  it('handles GET requests without body', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await safeFetch('https://example.com/api', { method: 'GET' });

    const callArgs = mockFetch.mock.calls[0];
    expect((callArgs[1] as RequestInit).method).toBe('GET');
    expect((callArgs[1] as RequestInit).body).toBeUndefined();
  });

  it('handles POST requests with JSON body', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const body = JSON.stringify({ model: 'test', messages: [] });
    await safeFetch('https://example.com/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const callArgs = mockFetch.mock.calls[0];
    expect((callArgs[1] as RequestInit).body).toBe(body);
  });

  it('handles POST requests with text body', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await safeFetch('https://example.com/api', {
      method: 'POST',
      body: 'plain text body',
    });

    const callArgs = mockFetch.mock.calls[0];
    expect((callArgs[1] as RequestInit).body).toBe('plain text body');
  });

  it('returns successful response on first try', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: 'success' }), { status: 200 })
    );

    const res = await safeFetch('https://example.com/api', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const json = await res.json() as { data: string };
    expect(json.data).toBe('success');
  });

  it('handles streaming responses', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: chunk1\n\ndata: chunk2\n\n', { status: 200 })
    );

    const res = await safeFetch('https://example.com/stream', { method: 'GET' });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('data: chunk1\n\ndata: chunk2\n\n');
  });

  it('handles HEAD requests without body', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200, headers: { 'Content-Length': '1234' } })
    );

    const res = await safeFetch('https://example.com/api', { method: 'HEAD' });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe('1234');
  });

  it('handles empty init object', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await safeFetch('https://example.com/api', {});

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect((mockFetch.mock.calls[0][1] as Record<string, unknown>).timeout).toBe(false);
  });

  it('handles undefined init', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await safeFetch('https://example.com/api', undefined);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect((mockFetch.mock.calls[0][1] as Record<string, unknown>).timeout).toBe(false);
  });

  it('handles no init argument', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await safeFetch('https://example.com/api');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect((mockFetch.mock.calls[0][1] as Record<string, unknown>).timeout).toBe(false);
  });

  it('retries with exponential backoff timing', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), {
        cause: { code: 'ETIMEDOUT' }
      }))
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), {
        cause: { code: 'ETIMEDOUT' }
      }))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const start = Date.now();
    await safeFetch('https://example.com/api', { method: 'GET' });
    const elapsed = Date.now() - start;

    // Should have waited ~100ms (first retry) + ~200ms (second retry) = ~300ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // ─── Rate limiting (429) retry tests ─────────────────────────────────────

  it('retries on 429 rate limited response', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const res = await safeFetch('https://example.com/api', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 with Retry-After header', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('Rate limited', {
          status: 429,
          headers: { 'Retry-After': '1' }
        })
      )
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const start = Date.now();
    const res = await safeFetch('https://example.com/api', { method: 'GET' });
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Should have waited ~1 second (from Retry-After header)
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  it('returns 429 after max retries exhausted', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Rate limited', { status: 429 }));

    const res = await safeFetch('https://example.com/api', { method: 'GET' });

    expect(res.status).toBe(429);
    // Initial + 3 retries = 4 total attempts
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('retries on 429 then succeeds on second attempt', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: 'success' }), { status: 200 }));

    const res = await safeFetch('https://example.com/api', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const json = await res.json() as { data: string };
    expect(json.data).toBe('success');
  });

  it('retries on 429 multiple times before succeeding', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const start = Date.now();
    const res = await safeFetch('https://example.com/api', { method: 'GET' });
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // Should have waited for 2 backoff periods
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });

  it('does not retry on 500 server error', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Server error', { status: 500 }));

    const res = await safeFetch('https://example.com/api', { method: 'GET' });

    expect(res.status).toBe(500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 503 service unavailable', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Service unavailable', { status: 503 }));

    const res = await safeFetch('https://example.com/api', { method: 'GET' });

    expect(res.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 for POST requests with body', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const body = JSON.stringify({ model: 'test', messages: [] });
    const res = await safeFetch('https://example.com/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Verify body is preserved on retry
    const callArgs = mockFetch.mock.calls[0];
    expect((callArgs[1] as RequestInit).body).toBe(body);
  });

  it('retries on 429 for Request objects', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const req = new Request('https://example.com/api', {
      method: 'POST',
      body: JSON.stringify({ test: true }),
    });

    const res = await safeFetch(req);

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('uses exponential backoff with jitter for 429 retries', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const start = Date.now();
    const res = await safeFetch('https://example.com/api', { method: 'GET' });
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(4);
    // Should have waited for 3 backoff periods (100ms, 200ms, 400ms + jitter)
    expect(elapsed).toBeGreaterThanOrEqual(500);
  });
});
