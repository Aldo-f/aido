import { PROVIDER_CONFIGS, type Provider } from './detector.js';
import { getRotator, loadKeysForProvider, KeyRotator } from './rotator.js';
import { logRequest as dbLogRequest, getFreeModels } from './db.js';
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
  specificModel?: string,
): Promise<AutoResult> {
  const tried: string[] = [];
  const priorities = priorityType === 'cloud' ? PRIORITIES.cloud 
                   : priorityType === 'local' ? PRIORITIES.local 
                   : AUTO_PRIORITY;

  const overallStartTime = Date.now();
  const logPrefix = specificModel ? `[auto/${specificModel}]` : '[auto]';
  console.log(`${logPrefix} Starting request (priority: ${priorityType})`);

  for (const { provider, model } of priorities) {
    const providerStartTime = Date.now();
    const rotator = getRotator(provider);
    const key = rotator.next();

    if (!key) {
      tried.push(`${provider}(no keys)`);
      console.log(`${logPrefix}   ${provider}: no keys available`);
      continue;
    }

    let modelToTry = model;
    if (specificModel) {
      const freeModels = getFreeModels(provider);
      const hasModel = freeModels.some(m => m.id === specificModel);
      if (!hasModel && specificModel !== model) {
        tried.push(`${provider}(${specificModel} not found)`);
        console.log(`${logPrefix}   ${provider}: ${specificModel} not available`);
        continue;
      }
      modelToTry = specificModel;
    }

    console.log(`${logPrefix}   ${provider}: trying ${modelToTry}...`);
    const config = PROVIDER_CONFIGS[provider];
    const isOllama = config.nativeFormat === true;

    let upstreamBody = body;
    try {
      const parsed = JSON.parse(body);
      if (priorityType === 'cloud' || priorityType === 'local') {
        parsed.model = modelToTry;
      } else if (!parsed.model || parsed.model === 'auto') {
        parsed.model = modelToTry;
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

export async function forwardAutoFree(
  openaiPath: string,
  method: string,
  body: string,
  priorityType: PriorityType = 'auto',
): Promise<AutoResult> {
  const tried: string[] = [];
  const overallStartTime = Date.now();
  console.log(`[auto-free] Starting request (priority: ${priorityType})`);

  // Get all providers that have keys configured
  const providers = Object.keys(PROVIDER_CONFIGS) as Provider[];
  const configuredProviders = providers.filter(provider => loadKeysForProvider(provider).length > 0);

  if (configuredProviders.length === 0) {
    console.log(`[auto-free] No providers with keys configured`);
    // Fall back to forwardAuto which will handle the no keys case
    return forwardAuto(openaiPath, method, body, priorityType);
  }

  // Try free models for each provider
  for (const provider of configuredProviders) {
    const freeModels = getFreeModels(provider);
    if (freeModels.length === 0) {
      console.log(`[auto-free]   ${provider}: no free models in cache`);
      tried.push(`${provider}(no free models)`);
      continue;
    }

    console.log(`[auto-free]   ${provider}: trying ${freeModels.length} free model(s)...`);
    
    // Create a rotator specifically for the free models of this provider
    const freeModelIds = freeModels.map(model => model.id);
    const rotator = new KeyRotator(provider, undefined, freeModelIds);

    let providerTried = 0;
    while (true) {
      const keyModel = rotator.getNextModel();
      if (!keyModel) {
        // No more available key-model pairs for this provider's free models
        break;
      }

      const key = keyModel.key;
      const model: string = keyModel.model;

      console.log(`[auto-free]     ${provider}: trying ${model}...`);
      const config = PROVIDER_CONFIGS[provider];
      const isOllama = config.nativeFormat === true;

      let upstreamBody = body;
      try {
        const parsed = JSON.parse(body);
        // For free models, we don't have priorityType concept, just set the model
        if (!parsed.model || parsed.model === 'auto') {
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
        tried.push(`${provider}/${model}(network error: ${(err as Error).message})`);
        providerTried++;
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
        // Also mark the model as limited
        rotator.markModelLimited(model, retryAfter ? parseInt(retryAfter, 10) : 3600);
        tried.push(`${provider}/${model}(429)`);
        console.log(`[auto-free]     ${provider}/${model} rate limited → trying next`);
        providerTried++;
        continue;
      }

      if (FATAL_STATUSES.has(res.status)) {
        tried.push(`${provider}/${model}(${res.status})`);
        console.log(`[auto-free]     ${provider}/${model} → ${res.status}, trying next`);
        providerTried++;
        continue;
      }

      // Success
      const totalTime = Date.now() - overallStartTime;
      console.log(`[auto-free]   ✓ ${provider}/${model} succeeded in ${totalTime}ms (tried: ${providerTried} key-model pairs)`);
      const responseHeaders: Record<string, string> = { 'content-type': 'application/json' };
      res.headers.forEach((v, k) => { if (k !== 'content-type') responseHeaders[k] = v; });

      return { status: res.status, body: responseBody, headers: responseHeaders, usedProvider: provider, usedModel: model };
    }

    console.log(`[auto-free]   ${provider}: exhausted all free model/key combinations`);
  }

  // If we get here, no free models worked. Fall back to paid models via forwardAuto.
  console.log(`[auto-free] All free models exhausted, falling back to paid models`);
  const fallbackResult = await forwardAuto(openaiPath, method, body, priorityType);
  return fallbackResult;
}
