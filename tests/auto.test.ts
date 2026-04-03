import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.DB_PATH = ':memory:';

const { resetDb, saveModels } = await import('../src/db.js');
const { resetRotators } = await import('../src/rotator.js');
const { forwardAuto, AUTO_PRIORITY } = await import('../src/auto.js');

beforeEach(() => {
  resetDb();
  resetRotators();
  vi.restoreAllMocks();
});

// Helper: mock fetch to return a specific status for a URL pattern
// Handles both string URLs and Request objects (safeFetch wraps URLs in Request)
function mockFetch(responses: Array<{ match: string; status: number; body: object }>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const urlStr = input instanceof Request ? input.url : String(input);
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
  it('starts with opencode as first priority', () => {
    expect(AUTO_PRIORITY[0].provider).toBe('opencode');
  });

  it('includes ollama-local before cloud providers', () => {
    const localIdx = AUTO_PRIORITY.findIndex(p => p.provider === 'ollama-local');
    const cloudIdx = AUTO_PRIORITY.findIndex(p => p.provider === 'openai');
    expect(localIdx).toBeLessThan(cloudIdx);
  });
});

describe('forwardAuto', () => {
  it('uses the first provider that succeeds', async () => {
    process.env.OPENCODE_KEYS = 'sk-' + 'z'.repeat(60);

    const fetchSpy = mockFetch([
      { match: 'opencode.ai', status: 200, body: SUCCESS_BODY },
    ]);

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.status).toBe(200);
    expect(result.usedProvider).toBe('opencode');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('skips providers with no keys configured', async () => {
    delete process.env.OPENCODE_KEYS;
    delete process.env.OLLAMA_KEYS;
    process.env.GROQ_KEYS = 'gsk_testkey';

    // ollama-local always has a 'local' placeholder key but will fail with network error
    // groq should be tried after ollama-local fails
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('localhost:11434')) return Promise.reject(new Error('ECONNREFUSED'));
      if (urlStr.includes('groq.com')) {
        return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
      }
      return Promise.reject(new Error(`unexpected: ${input}`));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.usedProvider).toBe('groq');
    expect(fetchSpy).toHaveBeenCalledTimes(2); // ollama-local (fail) + groq (success)
  });

  it('falls through on 429 and tries next provider', async () => {
    process.env.OPENCODE_KEYS = 'sk-' + 'z'.repeat(60);
    process.env.GROQ_KEYS = 'gsk_testkey';
    delete process.env.OLLAMA_KEYS;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('opencode.ai')) {
        return Promise.resolve(new Response('{}', { status: 429 }));
      }
      if (urlStr.includes('localhost:11434')) return Promise.reject(new Error('ECONNREFUSED'));
      if (urlStr.includes('groq.com')) {
        return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
      }
      return Promise.reject(new Error('unexpected'));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.usedProvider).toBe('groq');
    // safeFetch retries 429 (4 attempts), then ollama-local fails (1), then groq succeeds (1)
    // = 4 + 1 + 1 = 6 total fetch calls
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  it('returns 503 when all providers exhausted', async () => {
    delete process.env.OPENCODE_KEYS;
    delete process.env.OLLAMA_KEYS;
    delete process.env.GROQ_KEYS;
    delete process.env.OPENAI_KEYS;
    delete process.env.ANTHROPIC_KEYS;
    delete process.env.GOOGLE_KEYS;

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('localhost:11434')) {
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
    process.env.OPENCODE_KEYS = 'sk-' + 'z'.repeat(60);
    process.env.GROQ_KEYS = 'gsk_testkey';
    delete process.env.OLLAMA_KEYS;

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('opencode.ai')) return Promise.reject(new Error('EAI_AGAIN'));
      if (urlStr.includes('localhost:11434')) return Promise.reject(new Error('ECONNREFUSED'));
      // groq succeeds
      return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.usedProvider).toBe('groq');
  });

  it('includes all expected providers in priority list', () => {
    const providers = AUTO_PRIORITY.map(p => p.provider);
    expect(providers).toContain('opencode');
    expect(providers).toContain('ollama-local');
    expect(providers).toContain('ollama');
    expect(providers).toContain('groq');
    expect(providers).toContain('openai');
    expect(providers).toContain('anthropic');
    expect(providers).toContain('openrouter');
    // Note: google is not in the auto priority list
  });

  it('returns correct response body on success', async () => {
    process.env.OPENCODE_KEYS = 'sk-' + 'z'.repeat(60);

    const responseBody = {
      choices: [{ message: { role: 'assistant', content: 'Hello from opencode!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };

    mockFetch([
      { match: 'opencode.ai', status: 200, body: responseBody },
    ]);

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.status).toBe(200);
    const parsedBody = JSON.parse(result.body);
    expect(parsedBody.choices[0].message.content).toBe('Hello from opencode!');
  });

  it('returns response headers', async () => {
    process.env.OPENCODE_KEYS = 'sk-' + 'z'.repeat(60);

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('opencode.ai')) {
        return Promise.resolve(
          new Response(JSON.stringify(SUCCESS_BODY), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-ratelimit-remaining': '100',
              'x-ratelimit-reset': '3600',
            },
          })
        );
      }
      return Promise.reject(new Error(`No mock for ${urlStr}`));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.headers['x-ratelimit-remaining']).toBe('100');
    expect(result.headers['x-ratelimit-reset']).toBe('3600');
  });

  it('includes used model in result', async () => {
    process.env.OPENCODE_KEYS = 'sk-' + 'z'.repeat(60);

    mockFetch([
      { match: 'opencode.ai', status: 200, body: SUCCESS_BODY },
    ]);

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.usedModel).toBeDefined();
    expect(result.usedModel.length).toBeGreaterThan(0);
  });

  it('handles multiple keys for same provider', async () => {
    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2,sk-key3';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('opencode.ai')) {
        return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
      }
      return Promise.reject(new Error(`No mock for ${urlStr}`));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.status).toBe(200);
    expect(result.usedProvider).toBe('opencode');
    // Should succeed on first key
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('tries all keys before moving to next provider', async () => {
    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2';
    delete process.env.OLLAMA_KEYS;
    process.env.GROQ_KEYS = 'gsk_testkey';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('opencode.ai')) {
        return Promise.resolve(new Response('{}', { status: 429 }));
      }
      if (urlStr.includes('groq.com')) {
        return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
      }
      return Promise.reject(new Error(`No mock for ${urlStr}`));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.usedProvider).toBe('groq');
    // Both opencode keys should be tried (429 × 4 retries each = 8), then ollama-local fails (1), then groq succeeds (1)
    // = 8 + 1 + 1 = 10 total fetch calls
    expect(fetchSpy).toHaveBeenCalledTimes(10);
  });

  it('handles invalid keys (401) by trying next key', async () => {
    process.env.OPENCODE_KEYS = 'sk-invalid1,sk-valid';
    delete process.env.OLLAMA_KEYS;
    process.env.GROQ_KEYS = 'gsk_testkey';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('opencode.ai')) {
        return Promise.resolve(new Response('{}', { status: 401 }));
      }
      if (urlStr.includes('localhost:11434')) return Promise.reject(new Error('ECONNREFUSED'));
      if (urlStr.includes('groq.com')) {
        return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
      }
      return Promise.reject(new Error(`No mock for ${urlStr}`));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.usedProvider).toBe('groq');
  });

  it('handles fatal errors (400, 404) by trying next key', async () => {
    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2';
    delete process.env.OLLAMA_KEYS;
    process.env.GROQ_KEYS = 'gsk_testkey';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('opencode.ai')) {
        return Promise.resolve(new Response('{}', { status: 400 }));
      }
      if (urlStr.includes('groq.com')) {
        return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
      }
      return Promise.reject(new Error(`No mock for ${urlStr}`));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.usedProvider).toBe('groq');
  });

  it('tries multiple models for same provider', async () => {
    process.env.OPENCODE_KEYS = 'sk-' + 'z'.repeat(60);
    saveModels('opencode', [
      { id: 'model-a', name: 'Model A', provider: 'opencode', isFree: true, discoveredAt: Date.now(), expiresAt: Date.now() + 3600000 },
      { id: 'model-b', name: 'Model B', provider: 'opencode', isFree: true, discoveredAt: Date.now(), expiresAt: Date.now() + 3600000 },
    ]);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('opencode.ai')) {
        return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
      }
      return Promise.reject(new Error(`No mock for ${urlStr}`));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.status).toBe(200);
    // Should succeed on first model
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('tries next model when first model fails with 429', async () => {
    process.env.OPENCODE_KEYS = 'sk-' + 'z'.repeat(60);
    saveModels('opencode', [
      { id: 'model-a', name: 'Model A', provider: 'opencode', isFree: true, discoveredAt: Date.now(), expiresAt: Date.now() + 3600000 },
      { id: 'model-b', name: 'Model B', provider: 'opencode', isFree: true, discoveredAt: Date.now(), expiresAt: Date.now() + 3600000 },
    ]);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('opencode.ai')) {
        return Promise.resolve(new Response('{}', { status: 429 }));
      }
      return Promise.reject(new Error(`No mock for ${urlStr}`));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    // Both models should be tried, plus ollama-local fails, then other providers fail
    // The exact count depends on how many providers are tried
    expect(result.status).toBe(503);
    // safeFetch retries 429 (4 attempts per model), so 2 models × 4 = 8 opencode calls
    // + ollama-local (1 network error) + groq (1 network error) = 10 total
    expect(fetchSpy).toHaveBeenCalledTimes(10);
  });

  it('handles ollama provider', async () => {
    delete process.env.OPENCODE_KEYS;
    delete process.env.OLLAMA_KEYS;
    delete process.env.GROQ_KEYS;
    delete process.env.OPENAI_KEYS;
    delete process.env.ANTHROPIC_KEYS;
    delete process.env.GOOGLE_KEYS;
    delete process.env.OPENROUTER_KEYS;
    process.env.OLLAMA_KEYS = 'abcdef1234567890.testkey';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('ollama.com')) {
        return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
      }
      return Promise.reject(new Error(`No mock for ${urlStr}`));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.usedProvider).toBe('ollama');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('handles openai provider', async () => {
    delete process.env.OPENCODE_KEYS;
    delete process.env.OLLAMA_KEYS;
    delete process.env.GROQ_KEYS;
    delete process.env.ANTHROPIC_KEYS;
    delete process.env.GOOGLE_KEYS;
    delete process.env.OPENROUTER_KEYS;
    process.env.OPENAI_KEYS = 'sk-proj-test';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('api.openai.com')) {
        return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
      }
      return Promise.reject(new Error(`No mock for ${urlStr}`));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.usedProvider).toBe('openai');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('handles anthropic provider', async () => {
    delete process.env.OPENCODE_KEYS;
    delete process.env.OLLAMA_KEYS;
    delete process.env.GROQ_KEYS;
    delete process.env.OPENAI_KEYS;
    delete process.env.GOOGLE_KEYS;
    delete process.env.OPENROUTER_KEYS;
    process.env.ANTHROPIC_KEYS = 'sk-ant-test';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('api.anthropic.com')) {
        return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
      }
      return Promise.reject(new Error(`No mock for ${urlStr}`));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.usedProvider).toBe('anthropic');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('handles openrouter provider', async () => {
    delete process.env.OPENCODE_KEYS;
    delete process.env.OLLAMA_KEYS;
    delete process.env.GROQ_KEYS;
    delete process.env.OPENAI_KEYS;
    delete process.env.ANTHROPIC_KEYS;
    delete process.env.GOOGLE_KEYS;
    process.env.OPENROUTER_KEYS = 'sk-or-v1-test';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('openrouter.ai')) {
        return Promise.resolve(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));
      }
      return Promise.reject(new Error(`No mock for ${urlStr}`));
    });

    const result = await forwardAuto('/v1/chat/completions', 'POST', DUMMY_BODY);
    expect(result.usedProvider).toBe('openrouter');
    expect(fetchSpy).toHaveBeenCalled();
  });
});
