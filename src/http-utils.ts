/**
 * Shared HTTP utilities used across proxy, auto, and key-rotation modules.
 */

export const FATAL_STATUSES = new Set([400, 401, 403, 404]);

export const ALL_PROVIDERS = [
  'opencode',
  'openai',
  'anthropic',
  'groq',
  'google',
  'ollama',
  'ollama-local',
  'openrouter',
] as const;

export function extractResponseHeaders(res: Response): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  res.headers.forEach((v, k) => { if (k !== 'content-type') headers[k] = v; });
  return headers;
}

export function stripApiPrefix(path: string): string {
  if (path.startsWith('/v1') || path.startsWith('/api')) {
    return path.replace(/^\/v1/, '').replace(/^\/api/, '');
  }
  return path;
}
