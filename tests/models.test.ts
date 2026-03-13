import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.DB_PATH = ':memory:';

const { resetDb } = await import('../src/db.js');
const { fetchModels } = await import('../src/models.js');

beforeEach(() => {
  resetDb();
});

describe('fetchModels', () => {
  it('returns cached results without calling fetch again', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: [
          { id: 'big-pickle', owned_by: 'opencode' },
          { id: 'mimo-v2-flash-free', owned_by: 'opencode' },
        ]
      }), { status: 200 })
    );

    const first = await fetchModels('zen', 'sk-testkey12345678', false);
    expect(first).toHaveLength(2);
    expect(first[0].id).toBe('big-pickle');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call should use cache, no extra fetch
    const second = await fetchModels('zen', 'sk-testkey12345678', false);
    expect(second).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // still 1

    fetchSpy.mockRestore();
  });

  it('force sync bypasses cache', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'big-pickle' }] }), { status: 200 }))
    );

    await fetchModels('zen', 'sk-testkey12345678', false);
    await fetchModels('zen', 'sk-testkey12345678', true); // force

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });

  it('throws on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('EAI_AGAIN'));
    await expect(fetchModels('zen', 'sk-testkey12345678', false)).rejects.toThrow('Could not reach zen');
    vi.restoreAllMocks();
  });

  it('throws on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 })
    );
    await expect(fetchModels('zen', 'sk-testkey12345678', false)).rejects.toThrow('401');
    vi.restoreAllMocks();
  });

  it('returns info message for providers without /models endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await fetchModels('anthropic', 'sk-ant-test', false);
    expect(result[0].id).toContain('no /models endpoint');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
