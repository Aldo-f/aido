import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.DB_PATH = ':memory:';

const { resetDb } = await import('../src/db.js');
const { resetRotators, getRotator, loadKeysForProvider } = await import('../src/rotator.js');
const { tryKey, tryWithKeyRotation } = await import('../src/key-rotation.js');

beforeEach(() => {
  resetDb();
  resetRotators();
  vi.restoreAllMocks();
});

// Helper to create a mock response
function mockResponse(status: number, body: object = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('tryKey', () => {
  it('returns success on 200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, { choices: [] }));

    process.env.OPENCODE_KEYS = 'sk-test';
    const result = await tryKey(
      'opencode',
      'sk-test',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.status).toBe('success');
    expect(result.response?.status).toBe(200);
    expect(result.key).toBe('sk-test');
  });

  it('returns rate_limited on 429 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(429, { error: 'rate limited' }));

    process.env.OPENCODE_KEYS = 'sk-test';
    const result = await tryKey(
      'opencode',
      'sk-test',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.status).toBe('rate_limited');
    expect(result.response?.status).toBe(429);
  });

  it('returns invalid_key on 401 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(401, { error: 'unauthorized' }));

    process.env.OPENCODE_KEYS = 'sk-test';
    const result = await tryKey(
      'opencode',
      'sk-test',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.status).toBe('invalid_key');
    expect(result.response?.status).toBe(401);
  });

  it('returns invalid_key on 403 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(403, { error: 'forbidden' }));

    process.env.OPENCODE_KEYS = 'sk-test';
    const result = await tryKey(
      'opencode',
      'sk-test',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.status).toBe('invalid_key');
  });

  it('returns fatal on 400 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(400, { error: 'bad request' }));

    process.env.OPENCODE_KEYS = 'sk-test';
    const result = await tryKey(
      'opencode',
      'sk-test',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.status).toBe('fatal');
    expect(result.response?.status).toBe(400);
  });

  it('returns fatal on 404 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, { error: 'not found' }));

    process.env.OPENCODE_KEYS = 'sk-test';
    const result = await tryKey(
      'opencode',
      'sk-test',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.status).toBe('fatal');
  });

  it('returns network_error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed'));

    process.env.OPENCODE_KEYS = 'sk-test';
    const result = await tryKey(
      'opencode',
      'sk-test',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.status).toBe('network_error');
    expect(result.error).toBe('fetch failed');
  });

  it('sends correct auth header for opencode provider', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200));

    process.env.OPENCODE_KEYS = 'sk-opencode-key';
    await tryKey(
      'opencode',
      'sk-opencode-key',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    const callArgs = mockFetch.mock.calls[0];
    const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-opencode-key');
  });

  it('sends correct auth header for openai provider', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200));

    process.env.OPENAI_KEYS = 'sk-proj-key';
    await tryKey(
      'openai',
      'sk-proj-key',
      'gpt-4o-mini',
      'https://api.openai.com/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'gpt-4o-mini', messages: [] })
    );

    const callArgs = mockFetch.mock.calls[0];
    const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-proj-key');
  });

  it('sends correct auth header for anthropic provider', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200));

    process.env.ANTHROPIC_KEYS = 'sk-ant-key';
    await tryKey(
      'anthropic',
      'sk-ant-key',
      'claude-haiku',
      'https://api.anthropic.com/v1/messages',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'claude-haiku', messages: [] })
    );

    const callArgs = mockFetch.mock.calls[0];
    const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('sends correct auth header for groq provider', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200));

    process.env.GROQ_KEYS = 'gsk_key';
    await tryKey(
      'groq',
      'gsk_key',
      'llama-3.1-8b-instant',
      'https://api.groq.com/openai/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [] })
    );

    const callArgs = mockFetch.mock.calls[0];
    const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer gsk_key');
  });

  it('does not send body for GET requests', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200));

    process.env.OPENCODE_KEYS = 'sk-test';
    await tryKey(
      'opencode',
      'sk-test',
      'big-pickle',
      'https://opencode.ai/zen/v1/models',
      'GET',
      { 'content-type': 'application/json' },
      ''
    );

    const callArgs = mockFetch.mock.calls[0];
    expect((callArgs[1] as RequestInit).body).toBeUndefined();
  });

  it('does not send body for HEAD requests', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200));

    process.env.OPENCODE_KEYS = 'sk-test';
    await tryKey(
      'opencode',
      'sk-test',
      'big-pickle',
      'https://opencode.ai/zen/v1/models',
      'HEAD',
      { 'content-type': 'application/json' },
      ''
    );

    const callArgs = mockFetch.mock.calls[0];
    expect((callArgs[1] as RequestInit).body).toBeUndefined();
  });

  it('sends body for POST requests', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200));
    const body = JSON.stringify({ model: 'big-pickle', messages: [] });

    process.env.OPENCODE_KEYS = 'sk-test';
    await tryKey(
      'opencode',
      'sk-test',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      body
    );

    const callArgs = mockFetch.mock.calls[0];
    expect((callArgs[1] as RequestInit).body).toBe(body);
  });

  it('handles 500 server error as success (not fatal)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, { error: 'internal error' }));

    process.env.OPENCODE_KEYS = 'sk-test';
    const result = await tryKey(
      'opencode',
      'sk-test',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.status).toBe('success');
    expect(result.response?.status).toBe(500);
  });

  it('handles 503 service unavailable as success (not fatal)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(503, { error: 'unavailable' }));

    process.env.OPENCODE_KEYS = 'sk-test';
    const result = await tryKey(
      'opencode',
      'sk-test',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.status).toBe('success');
    expect(result.response?.status).toBe(503);
  });

  it('handles network error with cause object', async () => {
    const error = new Error('fetch failed');
    (error as any).cause = { code: 'ETIMEDOUT' };
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(error);

    process.env.OPENCODE_KEYS = 'sk-test';
    const result = await tryKey(
      'opencode',
      'sk-test',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.status).toBe('network_error');
  });

  it('handles ECONNREFUSED network error', async () => {
    const error = new Error('fetch failed');
    (error as any).cause = { code: 'ECONNREFUSED' };
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(error);

    process.env.OPENCODE_KEYS = 'sk-test';
    const result = await tryKey(
      'opencode',
      'sk-test',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.status).toBe('network_error');
  });
});

describe('tryWithKeyRotation', () => {
  it('returns response on first key success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, { choices: [] }));

    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2';
    const result = await tryWithKeyRotation(
      'opencode',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.res.status).toBe(200);
    expect(result.key).toBe('sk-key1');
  });

  it('tries next key on rate limit', async () => {
    // safeFetch retries 429 internally (3 retries = 4 total attempts per key)
    // After all retries exhausted, tryKey returns rate_limited and rotation tries next key
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' }))
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' }))
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' }))
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' }))
      .mockResolvedValueOnce(mockResponse(200, { choices: [] }));

    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2';
    const result = await tryWithKeyRotation(
      'opencode',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.res.status).toBe(200);
    expect(result.key).toBe('sk-key2');
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it('tries next key on invalid key', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse(401, { error: 'unauthorized' }))
      .mockResolvedValueOnce(mockResponse(200, { choices: [] }));

    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2';
    const result = await tryWithKeyRotation(
      'opencode',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.res.status).toBe(200);
    expect(result.key).toBe('sk-key2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('tries next key on network error', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(mockResponse(200, { choices: [] }));

    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2';
    const result = await tryWithKeyRotation(
      'opencode',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws when all keys are rate limited', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(429, { error: 'rate limited' }));

    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2';

    await expect(tryWithKeyRotation(
      'opencode',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    )).rejects.toThrow('All keys for opencode failed or are rate limited');
  });

  it('throws when no keys are available', async () => {
    delete process.env.OPENCODE_KEYS;

    await expect(tryWithKeyRotation(
      'opencode',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    )).rejects.toThrow('No API keys available for opencode');
  });

  it('throws on fatal error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(400, { error: 'bad request' }));

    process.env.OPENCODE_KEYS = 'sk-key1';

    await expect(tryWithKeyRotation(
      'opencode',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    )).rejects.toThrow('opencode returned 400');
  });

  it('tries all keys before giving up', async () => {
    // safeFetch retries 429 internally (3 retries = 4 total attempts per key)
    // After all retries exhausted, tryKey returns rate_limited and rotation tries next key
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockResponse(429, { error: 'rate limited' }));

    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2,sk-key3';

    await expect(tryWithKeyRotation(
      'opencode',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    )).rejects.toThrow('All keys for opencode failed or are rate limited');

    // 3 keys × 4 attempts each = 12 total
    expect(mockFetch).toHaveBeenCalledTimes(12);
  });

  it('handles mixed failure types (network + rate limit + success)', async () => {
    // Note: safeFetch retries on network errors (3 retries) and 429s (3 retries)
    // sk-key1: network error → 4 attempts total → gives up → rotates
    // sk-key2: 429 → 4 attempts total → gives up → rotates
    // sk-key3: 200 → success
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('fetch failed')) // sk-key1 attempt 1: network error
      .mockRejectedValueOnce(new Error('fetch failed')) // sk-key1 attempt 2: network error
      .mockRejectedValueOnce(new Error('fetch failed')) // sk-key1 attempt 3: network error
      .mockRejectedValueOnce(new Error('fetch failed')) // sk-key1 attempt 4: network error → gives up
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' })) // sk-key2 attempt 1: rate limited
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' })) // sk-key2 attempt 2: rate limited
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' })) // sk-key2 attempt 3: rate limited
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' })) // sk-key2 attempt 4: rate limited → gives up
      .mockResolvedValueOnce(mockResponse(200, { choices: [] })); // sk-key3: success

    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2,sk-key3';
    const result = await tryWithKeyRotation(
      'opencode',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.res.status).toBe(200);
    expect(result.key).toBe('sk-key3');
    expect(mockFetch).toHaveBeenCalledTimes(9);
  });

  it('handles mixed failure types (network + rate limit + success)', async () => {
    // Note: safeFetch retries on network errors (3 retries) and 429s (3 retries)
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('fetch failed')) // sk-key1 first attempt: network error
      .mockRejectedValueOnce(new Error('fetch failed')) // sk-key1 retry 1: network error
      .mockRejectedValueOnce(new Error('fetch failed')) // sk-key1 retry 2: network error
      .mockRejectedValueOnce(new Error('fetch failed')) // sk-key1 retry 3: network error → give up
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' })) // sk-key2 attempt 1: rate limited
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' })) // sk-key2 retry 1
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' })) // sk-key2 retry 2
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' })) // sk-key2 retry 3 → give up
      .mockResolvedValueOnce(mockResponse(200, { choices: [] })); // sk-key3: success

    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2,sk-key3';
    const result = await tryWithKeyRotation(
      'opencode',
      'big-pickle',
      'https://opencode.ai/zen/v1/chat/completions',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ model: 'big-pickle', messages: [] })
    );

    expect(result.res.status).toBe(200);
    // sk-key1 fails (4 network errors), sk-key2 rate limited (4 × 429), sk-key3 succeeds
    expect(result.key).toBe('sk-key3');
    expect(mockFetch).toHaveBeenCalledTimes(9);
  });
});

describe('loadKeysForProvider', () => {
  it('loads opencode keys from environment', () => {
    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2';
    const keys = loadKeysForProvider('opencode');
    expect(keys).toEqual(['sk-key1', 'sk-key2']);
  });

  it('loads openai keys from environment', () => {
    process.env.OPENAI_KEYS = 'sk-proj-key1,sk-proj-key2';
    const keys = loadKeysForProvider('openai');
    expect(keys).toEqual(['sk-proj-key1', 'sk-proj-key2']);
  });

  it('loads anthropic keys from environment', () => {
    process.env.ANTHROPIC_KEYS = 'sk-ant-key1';
    const keys = loadKeysForProvider('anthropic');
    expect(keys).toEqual(['sk-ant-key1']);
  });

  it('loads groq keys from environment', () => {
    process.env.GROQ_KEYS = 'gsk_key1,gsk_key2';
    const keys = loadKeysForProvider('groq');
    expect(keys).toEqual(['gsk_key1', 'gsk_key2']);
  });

  it('loads google keys from environment', () => {
    process.env.GOOGLE_KEYS = 'AIza_key1';
    const keys = loadKeysForProvider('google');
    expect(keys).toEqual(['AIza_key1']);
  });

  it('loads openrouter keys from environment', () => {
    process.env.OPENROUTER_KEYS = 'sk-or-v1-key1';
    const keys = loadKeysForProvider('openrouter');
    expect(keys).toEqual(['sk-or-v1-key1']);
  });

  it('loads ollama keys from environment', () => {
    process.env.OLLAMA_KEYS = 'abcdef1234567890.key1';
    const keys = loadKeysForProvider('ollama');
    expect(keys).toEqual(['abcdef1234567890.key1']);
  });

  it('returns empty array when no keys configured', () => {
    delete process.env.OPENCODE_KEYS;
    const keys = loadKeysForProvider('opencode');
    expect(keys).toEqual([]);
  });

  it('trims whitespace from keys', () => {
    process.env.OPENCODE_KEYS = '  sk-key1 , sk-key2  ';
    const keys = loadKeysForProvider('opencode');
    expect(keys).toEqual(['sk-key1', 'sk-key2']);
  });

  it('filters out empty keys', () => {
    process.env.OPENCODE_KEYS = 'sk-key1,,sk-key2,';
    const keys = loadKeysForProvider('opencode');
    expect(keys).toEqual(['sk-key1', 'sk-key2']);
  });
});

describe('getRotator', () => {
  it('returns same rotator instance for same provider', () => {
    process.env.OPENCODE_KEYS = 'sk-key1';
    const r1 = getRotator('opencode');
    const r2 = getRotator('opencode');
    expect(r1).toBe(r2);
  });

  it('returns different rotator instances for different providers', () => {
    process.env.OPENCODE_KEYS = 'sk-key1';
    process.env.OPENAI_KEYS = 'sk-proj-key1';
    const r1 = getRotator('opencode');
    const r2 = getRotator('openai');
    expect(r1).not.toBe(r2);
  });

  it('rotator has correct key count', () => {
    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2,sk-key3';
    const rotator = getRotator('opencode');
    expect(rotator.count).toBe(3);
  });

  it('rotator returns available keys', () => {
    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2';
    const rotator = getRotator('opencode');
    const keys = rotator.availableKeys();
    expect(keys.length).toBe(2);
  });
});
