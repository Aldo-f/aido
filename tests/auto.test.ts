import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.DB_PATH = ':memory:';

const { resetDb } = await import('../src/db.js');
const { resetRotators } = await import('../src/rotator.js');
const { forwardAuto, AUTO_PRIORITY } = await import('../src/auto.js');

beforeEach(() => {
  resetDb();
  resetRotators();
  vi.restoreAllMocks();
});

// Helper: mock fetch to return a specific status for a URL pattern
function mockFetch(responses: Array<{ match: string; status: number; body: object }>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const urlStr = String(url);
    for (const r of responses) {
      if (urlStr.includes(r.match)) {
        return Promise.resolve(
          new Response(JSON.stringify(r.body), {
            status: r.status,
            headers: { 'content-type': 'application/json' },
          })
        );
      }
    }
    return Promise.reject(new Error(`No mock for ${urlStr}`));
  });
}

const DUMMY_BODY = JSON.stringify({
  model: 'auto',
  messages: [{ role: 'user', content: 'hi' }],
});

const SUCCESS_BODY = {
  choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
};

describe('AUTO_PRIORITY', () => {
  it('starts with zen as first priority', () => {
    expect(AUTO_PRIORITY[0].provider).toBe('zen');
  });

  it('includes ollama-local before cloud providers', () => {
    const localIdx = AUTO_PRIORITY.findIndex(p => p.provider === 'ollama-local');
    const cloudIdx = AUTO_PRIORITY.findIndex(p => p.provider === 'openai');
    expect(localIdx).toBeLessThan(cloudIdx);
  });
});

describe('forwardAuto', () => {
  it('uses the first provider that succeeds', async () => {
    process.env.ZEN_KEYS = 'sk-' + 'z'.repeat(60);

    const fetchSpy = mockFetch([
      { match: 'opencode.ai', status: 200, body: SUCCESS_BODY },
    ]);

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.status).toBe(200);
    expect(result.usedProvider).toBe('zen');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('skips providers with no keys configured', async () => {
    delete process.env.ZEN_KEYS;
    delete process.env.OLLAMA_KEYS;
    process.env.GROQ_KEYS = 'gsk_testkey';

    // ollama-local always has a 'local' placeholder key but will fail with network error
    // groq should be tried after ollama-local fails
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).includes('localhost:11434')) return Promise.reject(new Error('ECONNREFUSED'));
      if (String(url).includes('groq.com')) {
        return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.usedProvider).toBe('groq');
    expect(fetchSpy).toHaveBeenCalledTimes(2); // ollama-local (fail) + groq (success)
  });

  it('falls through on 429 and tries next provider', async () => {
    process.env.ZEN_KEYS = 'sk-' + 'z'.repeat(60);
    process.env.GROQ_KEYS = 'gsk_testkey';
    delete process.env.OLLAMA_KEYS;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).includes('opencode.ai')) {
        return Promise.resolve(new Response('{}', { status: 429 }));
      }
      if (String(url).includes('localhost:11434')) return Promise.reject(new Error('ECONNREFUSED'));
      if (String(url).includes('groq.com')) {
        return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
      }
      return Promise.reject(new Error('unexpected'));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.usedProvider).toBe('groq');
    // zen (429) + ollama-local (network fail) + groq (success)
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('returns 503 when all providers exhausted', async () => {
    delete process.env.ZEN_KEYS;
    delete process.env.OLLAMA_KEYS;
    delete process.env.GROQ_KEYS;
    delete process.env.OPENAI_KEYS;
    delete process.env.ANTHROPIC_KEYS;
    delete process.env.GOOGLE_KEYS;

    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).includes('localhost:11434')) {
        return Promise.reject(new Error('ECONNREFUSED'));
      }
      return Promise.reject(new Error('No mock for URL'));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.status).toBe(503);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('exhausted');
    expect(body.hint).toContain('aido add');
  });

  it('skips providers that throw network errors', async () => {
    process.env.ZEN_KEYS = 'sk-' + 'z'.repeat(60);
    process.env.GROQ_KEYS = 'gsk_testkey';
    delete process.env.OLLAMA_KEYS;

    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).includes('opencode.ai')) return Promise.reject(new Error('EAI_AGAIN'));
      if (String(url).includes('localhost:11434')) return Promise.reject(new Error('ECONNREFUSED'));
      // groq succeeds
      return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.usedProvider).toBe('groq');
  });
});
