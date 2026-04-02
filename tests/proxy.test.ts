import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.DB_PATH = ':memory:';

const { resetDb } = await import('../src/db.js');
const { resetRotators } = await import('../src/rotator.js');
const { createProxyServer, resolveProvider } = await import('../src/proxy.js');

beforeEach(() => {
  resetDb();
  resetRotators();
  vi.restoreAllMocks();
});

describe('resolveProvider', () => {
  it('routes aido/auto to auto provider', () => {
    const result = resolveProvider('/v1/chat/completions', JSON.stringify({ model: 'aido/auto' }));
    expect(result.provider).toBe('auto');
    expect(result.isAidoAuto).toBe(true);
  });

  it('routes aido/cloud to auto provider with cloud priority', () => {
    const result = resolveProvider('/v1/chat/completions', JSON.stringify({ model: 'aido/cloud' }));
    expect(result.provider).toBe('auto');
    expect(result.priorityType).toBe('cloud');
  });

  it('routes aido/local to ollama-local provider', () => {
    const result = resolveProvider('/v1/chat/completions', JSON.stringify({ model: 'aido/local' }));
    expect(result.provider).toBe('ollama-local');
    expect(result.priorityType).toBe('local');
  });

  it('routes aido/opencode/model to opencode provider', () => {
    const result = resolveProvider('/v1/chat/completions', JSON.stringify({ model: 'aido/opencode/big-pickle' }));
    expect(result.provider).toBe('opencode');
    expect(result.model).toBe('big-pickle');
    expect(result.isAidoAuto).toBe(false);
  });

  it('routes aido/groq/model to groq provider', () => {
    const result = resolveProvider('/v1/chat/completions', JSON.stringify({ model: 'aido/groq/llama-3.1-8b-instant' }));
    expect(result.provider).toBe('groq');
    expect(result.model).toBe('llama-3.1-8b-instant');
  });

  it('routes aido/openai/model to openai provider', () => {
    const result = resolveProvider('/v1/chat/completions', JSON.stringify({ model: 'aido/openai/gpt-4o-mini' }));
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o-mini');
  });

  it('routes aido/anthropic/model to anthropic provider', () => {
    const result = resolveProvider('/v1/chat/completions', JSON.stringify({ model: 'aido/anthropic/claude-haiku' }));
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-haiku');
  });

  it('routes aido/openrouter/model to openrouter provider', () => {
    const result = resolveProvider('/v1/chat/completions', JSON.stringify({ model: 'aido/openrouter/nvidia/nemotron-3-super-120b-a12b:free' }));
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('nvidia/nemotron-3-super-120b-a12b:free');
  });

  it('routes aido/google/model to google provider', () => {
    const result = resolveProvider('/v1/chat/completions', JSON.stringify({ model: 'aido/google/gemini-1.5-flash' }));
    expect(result.provider).toBe('google');
    expect(result.model).toBe('gemini-1.5-flash');
  });

  it('routes aido/ollama/model to ollama provider', () => {
    const result = resolveProvider('/v1/chat/completions', JSON.stringify({ model: 'aido/ollama/llama3' }));
    expect(result.provider).toBe('ollama');
    expect(result.model).toBe('llama3');
  });

  it('routes aido/ollama-local/model to ollama-local provider', () => {
    const result = resolveProvider('/v1/chat/completions', JSON.stringify({ model: 'aido/ollama-local/qwen3:8b' }));
    expect(result.provider).toBe('ollama-local');
    expect(result.model).toBe('qwen3:8b');
  });

  it('routes provider/model (without aido/ prefix) to specific provider', () => {
    const result = resolveProvider('/v1/chat/completions', JSON.stringify({ model: 'opencode/big-pickle' }));
    expect(result.provider).toBe('opencode');
    expect(result.model).toBe('big-pickle');
  });

  it('defaults to opencode provider when no model in body', () => {
    const result = resolveProvider('/v1/chat/completions', '{}');
    expect(result.provider).toBe('opencode');
  });

  it('defaults to opencode provider when body is not JSON', () => {
    const result = resolveProvider('/v1/chat/completions', 'not json');
    expect(result.provider).toBe('opencode');
  });

  it('defaults to opencode provider when body is empty', () => {
    const result = resolveProvider('/v1/chat/completions', '');
    expect(result.provider).toBe('opencode');
  });

  it('handles /v1/models path correctly', () => {
    const result = resolveProvider('/v1/models', '{}');
    expect(result.provider).toBe('opencode');
    expect(result.upstreamPath).toBe('/v1/models');
  });

  it('handles /v1/chat/completions path correctly', () => {
    const result = resolveProvider('/v1/chat/completions', '{}');
    expect(result.provider).toBe('opencode');
    expect(result.upstreamPath).toBe('/v1/chat/completions');
  });

  it('handles complex model names with slashes', () => {
    const result = resolveProvider('/v1/chat/completions', JSON.stringify({ model: 'aido/openrouter/nvidia/nemotron-3-super-120b-a12b:free' }));
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('nvidia/nemotron-3-super-120b-a12b:free');
  });

  it('handles model names with colons', () => {
    const result = resolveProvider('/v1/chat/completions', JSON.stringify({ model: 'aido/ollama-local/qwen3:8b' }));
    expect(result.provider).toBe('ollama-local');
    expect(result.model).toBe('qwen3:8b');
  });
});

describe('createProxyServer', () => {
  it('creates an HTTP server', () => {
    const server = createProxyServer();
    expect(server).toBeDefined();
    expect(typeof server.listen).toBe('function');
    expect(typeof server.close).toBe('function');
    server.close();
  });

  it('returns 503 when no API keys configured', async () => {
    const server = createProxyServer();
    delete process.env.OPENCODE_KEYS;

    const port = await new Promise<number>((resolve) => {
      server.listen(0, () => {
        resolve((server.address() as { port: number }).port);
      });
    });

    const res = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'big-pickle', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(res.status).toBe(503);
    server.close();
  });

  it('returns 502 on upstream network error', async () => {
    const server = createProxyServer();
    process.env.OPENCODE_KEYS = 'sk-test-key';

    // Mock fetch to fail for upstream API calls
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('opencode.ai')) {
        return Promise.reject(new Error('fetch failed'));
      }
      return originalFetch(input);
    });

    const port = await new Promise<number>((resolve) => {
      server.listen(0, () => {
        resolve((server.address() as { port: number }).port);
      });
    });

    const res = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'big-pickle', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Upstream error');
    server.close();
    globalThis.fetch = originalFetch;
  });

  it('handles GET requests to /v1/models', async () => {
    const server = createProxyServer();
    process.env.OPENCODE_KEYS = 'sk-test-key';

    // Mock fetch for upstream API calls
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('opencode.ai')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: 'big-pickle', object: 'model' }] }), { status: 200 })
        );
      }
      return originalFetch(input);
    });

    const port = await new Promise<number>((resolve) => {
      server.listen(0, () => {
        resolve((server.address() as { port: number }).port);
      });
    });

    const res = await fetch(`http://localhost:${port}/v1/models`);

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string }> };
    expect(body.data).toBeDefined();
    server.close();
    globalThis.fetch = originalFetch;
  });

  it('enriches model responses with capabilities', async () => {
    const server = createProxyServer();
    process.env.OPENCODE_KEYS = 'sk-test-key';

    // Mock fetch for upstream API calls
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      if (urlStr.includes('opencode.ai')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: 'big-pickle', object: 'model' }] }), { status: 200 })
        );
      }
      return originalFetch(input);
    });

    const port = await new Promise<number>((resolve) => {
      server.listen(0, () => {
        resolve((server.address() as { port: number }).port);
      });
    });

    const res = await fetch(`http://localhost:${port}/v1/models`);

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string; owned_by: string }> };
    // Model responses should be enriched with capabilities
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    // The first model should have owned_by set to 'aido'
    expect(body.data[0].owned_by).toBe('aido');
    server.close();
    globalThis.fetch = originalFetch;
  });
});
