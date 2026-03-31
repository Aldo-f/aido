import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.DB_PATH = ':memory:';

const { resetDb, saveModels } = await import('../src/db.js');
const { resetRotators } = await import('../src/rotator.js');
const { run } = await import('../src/run.js');

function saveModel(provider: string, modelId: string, modelName: string, isFree: number) {
  saveModels(provider, [{
    id: modelId,
    name: modelName,
    provider,
    isFree: isFree === 1,
    discoveredAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  }]);
}

beforeEach(() => {
  resetDb();
  resetRotators();
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
});

// Helper to create a mock response
function mockResponse(status: number, body: object = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('run with specific provider', () => {
  it('sends request to correct provider URL', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'opencode', model: 'big-pickle' });

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://opencode.ai/zen/v1/chat/completions');
  });

  it('sends request to openai provider URL', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.OPENAI_KEYS = 'sk-proj-test';
    saveModel('openai', 'gpt-4o-mini', 'gpt-4o-mini', 1);

    await run('Say hi', { provider: 'openai', model: 'gpt-4o-mini' });

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('sends request to groq provider URL', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.GROQ_KEYS = 'gsk_test';
    saveModel('groq', 'llama-3.1-8b-instant', 'llama-3.1-8b-instant', 1);

    await run('Say hi', { provider: 'groq', model: 'llama-3.1-8b-instant' });

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://api.groq.com/openai/v1/chat/completions');
  });

  it('sends request to anthropic provider URL', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.ANTHROPIC_KEYS = 'sk-ant-test';
    saveModel('anthropic', 'claude-haiku', 'claude-haiku', 1);

    await run('Say hi', { provider: 'anthropic', model: 'claude-haiku' });

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://api.anthropic.com/chat/completions');
  });

  it('sends correct request body', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'opencode', model: 'big-pickle' });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    expect(body.model).toBe('big-pickle');
    expect(body.messages).toEqual([{ role: 'user', content: 'Say hi' }]);
    expect(body.stream).toBe(false);
  });

  it('sends correct request headers', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'opencode', model: 'big-pickle' });

    const callArgs = mockFetch.mock.calls[0];
    const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test-key');
    expect(headers['content-type']).toBe('application/json');
  });

  it('prints response content for non-streaming', async () => {
    const logSpy = vi.spyOn(console, 'log');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'opencode', model: 'big-pickle' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Hello!'));
  });

  it('handles streaming responses', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logSpy = vi.spyOn(console, 'log');

    const streamBody = 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n' +
                       'data: {"choices":[{"delta":{"content":"lo!"}}]}\n' +
                       'data: [DONE]\n';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(streamBody, { status: 200 })
    );

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'opencode', model: 'big-pickle', stream: true });

    expect(writeSpy).toHaveBeenCalledWith('[response] ');
    expect(writeSpy).toHaveBeenCalledWith('Hel');
    expect(writeSpy).toHaveBeenCalledWith('lo!');
    expect(logSpy).toHaveBeenCalled();
  });

  it('tries next model when first fails', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' }))
      .mockResolvedValueOnce(mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] }));

    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);
    saveModel('opencode', 'nemotron', 'nemotron', 1);

    await run('Say hi', { provider: 'opencode' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('handles rate limiting gracefully', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' }))
      .mockResolvedValueOnce(mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] }));

    process.env.OPENCODE_KEYS = 'sk-key1,sk-key2';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'opencode', model: 'big-pickle' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('handles invalid key (401)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(401, { error: 'unauthorized' })
    );

    process.env.OPENCODE_KEYS = 'sk-invalid-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'opencode', model: 'big-pickle' });

    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('handles network errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed'));

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'opencode', model: 'big-pickle' });

    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits when no API keys configured', async () => {
    delete process.env.OPENCODE_KEYS;
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'opencode', model: 'big-pickle' });

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('No available API keys')
    );
  });

  it('uses default model when no model specified', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'opencode' });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    expect(body.model).toBe('big-pickle');
  });

  it('uses free models strategy when specified', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);
    saveModel('opencode', 'paid-model', 'paid-model', 0);

    await run('Say hi', { provider: 'opencode', strategy: 'free' });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    expect(body.model).toBe('big-pickle');
  });

  it('uses paid models strategy when specified', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);
    saveModel('opencode', 'paid-model', 'paid-model', 0);

    await run('Say hi', { provider: 'opencode', strategy: 'paid' });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    expect(body.model).toBe('paid-model');
  });

  it('uses both free and paid models when strategy is both', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);
    saveModel('opencode', 'paid-model', 'paid-model', 0);

    await run('Say hi', { provider: 'opencode', strategy: 'both' });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    // Free models should be tried first
    expect(body.model).toBe('big-pickle');
  });

  it('handles empty response content', async () => {
    const logSpy = vi.spyOn(console, 'log');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: '' } }] })
    );

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'opencode', model: 'big-pickle' });

    // Empty string content is still printed (not treated as no response)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('opencode/big-pickle'));
  });

  it('handles response with no choices', async () => {
    const logSpy = vi.spyOn(console, 'log');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, {})
    );

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'opencode', model: 'big-pickle' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('(no response)'));
  });

  it('handles ollama-local provider', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('ECONNREFUSED'));

    process.env.OLLAMA_KEYS = 'local';
    saveModel('ollama-local', 'qwen3:8b', 'qwen3:8b', 1);

    await run('Say hi', { provider: 'ollama-local', model: 'qwen3:8b' });

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('handles ollama-local with custom host', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('ECONNREFUSED'));

    process.env.OLLAMA_KEYS = 'local';
    process.env.OLLAMA_HOST = 'http://192.168.1.100:11434';
    saveModel('ollama-local', 'qwen3:8b', 'qwen3:8b', 1);

    await run('Say hi', { provider: 'ollama-local', model: 'qwen3:8b' });

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('http://192.168.1.100:11434/v1/chat/completions');
  });

  it('handles openrouter provider', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.OPENROUTER_KEYS = 'sk-or-v1-test';
    saveModel('openrouter', 'nvidia/nemotron-3-super-120b-a12b:free', 'nvidia/nemotron-3-super-120b-a12b:free', 1);

    await run('Say hi', { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' });

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('handles google provider', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.GOOGLE_KEYS = 'AIza_test';
    saveModel('google', 'gemini-1.5-flash', 'gemini-1.5-flash', 1);

    await run('Say hi', { provider: 'google', model: 'gemini-1.5-flash' });

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://generativelanguage.googleapis.com/v1beta/chat/completions');
  });

  it('handles ollama cloud provider', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.OLLAMA_KEYS = 'abcdef1234567890.testkey';
    saveModel('ollama', 'llama3', 'llama3', 1);

    await run('Say hi', { provider: 'ollama', model: 'llama3' });

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://ollama.com/api/chat/completions');
  });
});

describe('run with auto provider', () => {
  it('routes aido/opencode/model to specific provider', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'auto', model: 'opencode/big-pickle' });

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://opencode.ai/zen/v1/chat/completions');
  });

  it('routes aido/auto to forwardAuto', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'auto', model: 'auto' });

    expect(mockFetch).toHaveBeenCalled();
  });

  it('routes aido/cloud to cloud priority', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'Hello!' } }] })
    );

    process.env.OPENAI_KEYS = 'sk-proj-test';
    saveModel('openai', 'gpt-4o-mini', 'gpt-4o-mini', 1);

    await run('Say hi', { provider: 'auto', model: 'cloud' });

    expect(mockFetch).toHaveBeenCalled();
  });

  it('routes aido/local to local priority', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('ECONNREFUSED'));

    process.env.OLLAMA_KEYS = 'local';
    saveModel('ollama-local', 'qwen3:8b', 'qwen3:8b', 1);

    await run('Say hi', { provider: 'auto', model: 'local' });

    expect(mockFetch).toHaveBeenCalled();
  });

  it('handles 503 when all providers exhausted', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    process.env.OLLAMA_KEYS = 'local';
    saveModel('ollama-local', 'qwen3:8b', 'qwen3:8b', 1);

    await run('Say hi', { provider: 'auto', model: 'auto' });

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('All providers exhausted')
    );
  });

  it('handles non-200 response from auto routing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(500, { error: 'internal error' })
    );

    process.env.OPENCODE_KEYS = 'sk-test-key';
    saveModel('opencode', 'big-pickle', 'big-pickle', 1);

    await run('Say hi', { provider: 'auto', model: 'auto' });

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Error 500')
    );
  });
});
