import { PROVIDER_CONFIGS, type Provider } from './detector.js';
import { getRotator } from './rotator.js';
import { logRequest as dbLogRequest } from './db.js';
import { logRequest as fileLogRequest } from './logger.js';
import { toOllamaBody, fromOllamaResponse, toOllamaPath } from './ollama.js';
import { PRIORITIES } from './priorities.js';

export const AUTO_PRIORITY = PRIORITIES.auto;

export type PriorityType = 'auto' | 'cloud' | 'local';

/** Non-retryable HTTP status codes */
const FATAL_STATUSES = new Set([400, 401, 403, 404]);

export interface AutoResult {
  status: number;
  body: string;
  headers: Record<string, string>;
  usedProvider: Provider;
  usedModel: string;
}

export async function forwardAuto(
  openaiPath: string,
  method: string,
  body: string,
  priorityType: PriorityType = 'auto',
): Promise<AutoResult> {
  const tried: string[] = [];
  const priorities = priorityType === 'cloud' ? PRIORITIES.cloud 
                  : priorityType === 'local' ? PRIORITIES.local 
                  : AUTO_PRIORITY;

  const overallStartTime = Date.now();
  console.log(`[auto] Starting request (priority: ${priorityType})`);

  for (const { provider, model } of priorities) {
    const providerStartTime = Date.now();
    const rotator = getRotator(provider);
    const key = rotator.next();

    if (!key) {
      tried.push(`${provider}(no keys)`);
      console.log(`[auto]   ${provider}: no keys available`);
      continue;
    }

    console.log(`[auto]   ${provider}: trying ${model}...`);
    const config = PROVIDER_CONFIGS[provider];
    const isOllama = config.nativeFormat === true;

    let upstreamBody = body;
    try {
      const parsed = JSON.parse(body);
      if (priorityType === 'cloud' || priorityType === 'local') {
        parsed.model = model;
      } else if (!parsed.model || parsed.model === 'auto') {
        parsed.model = model;
      }
      upstreamBody = JSON.stringify(parsed);
    } catch { /* leave body as-is */ }

    if (isOllama) upstreamBody = toOllamaBody(upstreamBody);

    let upstreamPath = isOllama ? toOllamaPath(openaiPath) : openaiPath;
    // For ollama, baseUrl already ends with /api or /v1 - don't double-prefix
    if (upstreamPath.startsWith('/v1') || upstreamPath.startsWith('/api')) {
      upstreamPath = upstreamPath.replace(/^\/v1/, '').replace(/^\/api/, '');
    }
    const url = `${config.baseUrl}${upstreamPath}`;
    const startTime = Date.now();

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          ...config.authHeader(key),
        },
        body: method !== 'GET' && method !== 'HEAD' ? upstreamBody : undefined,
      });
    } catch (err) {
      tried.push(`${provider}(network error: ${(err as Error).message})`);
      continue;
    }

    const rawBody = await res.text();
    const responseBody = isOllama ? fromOllamaResponse(rawBody) : rawBody;
    const duration = Date.now() - startTime;
    dbLogRequest(key, provider, res.status);
    fileLogRequest({ provider, model, key, status: res.status, duration, responseSize: rawBody.length });

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after');
      rotator.markLimited(key, retryAfter ? parseInt(retryAfter, 10) : 3600);
      tried.push(`${provider}(429)`);
      console.log(`[auto] ${provider}/${model} rate limited → trying next`);
      continue;
    }

    if (FATAL_STATUSES.has(res.status)) {
      tried.push(`${provider}(${res.status})`);
      console.log(`[auto] ${provider}/${model} → ${res.status}, trying next`);
      continue;
    }

    // Success
    const totalTime = Date.now() - overallStartTime;
    console.log(`[auto] ✓ ${provider}/${model} succeeded in ${totalTime}ms (tried: ${tried.join(', ') || 'none'})`);
    const responseHeaders: Record<string, string> = { 'content-type': 'application/json' };
    res.headers.forEach((v, k) => { if (k !== 'content-type') responseHeaders[k] = v; });

    return { status: res.status, body: responseBody, headers: responseHeaders, usedProvider: provider, usedModel: model };
  }

  const totalTime = Date.now() - overallStartTime;
  console.log(`[auto] All providers exhausted after ${totalTime}ms. Tried: ${tried.join(', ')}`);
  return {
    status: 503,
    body: JSON.stringify({
      error: 'All providers exhausted.',
      tried,
      hint: 'Add more API keys with: aido add <key>',
    }),
    headers: { 'content-type': 'application/json' },
    usedProvider: 'zen',
    usedModel: 'auto',
  };
}
