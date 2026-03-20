import { PROVIDER_CONFIGS, type Provider } from './detector.js';
import { getRotator, loadKeysForProvider, KeyRotator } from './rotator.js';
import { logRequest as dbLogRequest, getFreeModels } from './db.js';
import { logRequest as fileLogRequest } from './logger.js';
import { toOllamaBody, fromOllamaResponse, toOllamaPath } from './ollama.js';
import { PRIORITIES } from './priorities.js';
import { tryKey } from './key-rotation.js';

export const AUTO_PRIORITY = PRIORITIES.auto;

export type PriorityType = 'auto' | 'cloud' | 'local';

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
    const rotator = getRotator(provider);
    const availableKeys = rotator.availableKeys();

    if (availableKeys.length === 0) {
      tried.push(`${provider}(no keys)`);
      console.log(`${logPrefix}   ${provider}: no keys available`);
      continue;
    }

    let modelToTry = model;
    if (specificModel && specificModel !== 'auto') {
      const freeModels = getFreeModels(provider);
      const hasModel = freeModels.some(m => m.id === specificModel);
      if (!hasModel && specificModel !== model) {
        tried.push(`${provider}(${specificModel} not found)`);
        console.log(`${logPrefix}   ${provider}: ${specificModel} not available`);
        continue;
      }
      modelToTry = specificModel;
    }

    console.log(`${logPrefix}   ${provider}: trying ${modelToTry} with ${availableKeys.length} key(s)...`);
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
    } catch {}

    if (isOllama) upstreamBody = toOllamaBody(upstreamBody);

    let upstreamPath = isOllama ? toOllamaPath(openaiPath) : openaiPath;
    if (upstreamPath.startsWith('/v1') || upstreamPath.startsWith('/api')) {
      upstreamPath = upstreamPath.replace(/^\/v1/, '').replace(/^\/api/, '');
    }
    const url = `${config.baseUrl}${upstreamPath}`;

    let success = false;

    for (const key of availableKeys) {
      const startTime = Date.now();
      const baseHeaders = { 'content-type': 'application/json' };
      const result = await tryKey(provider, key, modelToTry, url, method, baseHeaders, upstreamBody);

      const duration = Date.now() - startTime;
      const rawBody = result.response ? await result.response.text() : '';
      const responseBody = isOllama ? fromOllamaResponse(rawBody) : rawBody;
      fileLogRequest({ provider, model: modelToTry, key, status: result.response?.status ?? 0, duration, responseSize: rawBody.length });

      if (result.status === 'rate_limited') {
        tried.push(`${provider}/${modelToTry}(429 on ...${key.slice(-8)})`);
        console.log(`[auto] ${provider}/${modelToTry} rate limited (key ...${key.slice(-8)}) → trying next key`);
        continue;
      }

      if (result.status === 'invalid_key') {
        tried.push(`${provider}/${modelToTry}(invalid key ...${key.slice(-8)})`);
        console.log(`[auto] ${provider}/${modelToTry} invalid key (...${key.slice(-8)}) → trying next key`);
        continue;
      }

      if (result.status === 'network_error') {
        tried.push(`${provider}/${modelToTry}(network error)`);
        console.log(`[auto] ${provider}/${modelToTry} network error → trying next key`);
        continue;
      }

      if (result.status === 'fatal') {
        tried.push(`${provider}/${modelToTry}(${result.response?.status})`);
        console.log(`[auto] ${provider}/${modelToTry} → ${result.response?.status}, trying next key`);
        continue;
      }

      if (result.status === 'success' && result.response) {
        const totalTime = Date.now() - overallStartTime;
        console.log(`[auto] ✓ ${provider}/${modelToTry} succeeded in ${totalTime}ms (tried: ${tried.join(', ') || 'none'})`);
        const responseHeaders: Record<string, string> = { 'content-type': 'application/json' };
        result.response.headers.forEach((v, k) => { if (k !== 'content-type') responseHeaders[k] = v; });
        return { status: result.response.status, body: responseBody, headers: responseHeaders, usedProvider: provider, usedModel: modelToTry };
      }
    }

    console.log(`[auto] ${provider}: all keys exhausted for ${modelToTry}`);
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

  const providers = Object.keys(PROVIDER_CONFIGS) as Provider[];
  const configuredProviders = providers.filter(provider => loadKeysForProvider(provider).length > 0);

  if (configuredProviders.length === 0) {
    console.log(`[auto-free] No providers with keys configured`);
    return forwardAuto(openaiPath, method, body, priorityType);
  }

  for (const provider of configuredProviders) {
    const freeModels = getFreeModels(provider);
    if (freeModels.length === 0) {
      console.log(`[auto-free]   ${provider}: no free models in cache`);
      tried.push(`${provider}(no free models)`);
      continue;
    }

    console.log(`[auto-free]   ${provider}: trying ${freeModels.length} free model(s)...`);

    const freeModelIds = freeModels.map(model => model.id);
    const rotator = new KeyRotator(provider, undefined, freeModelIds);

    let providerTried = 0;
    while (true) {
      const keyModel = rotator.getNextModel();
      if (!keyModel) break;

      const key = keyModel.key;
      const model: string = keyModel.model;

      console.log(`[auto-free]     ${provider}: trying ${model}...`);
      const config = PROVIDER_CONFIGS[provider];
      const isOllama = config.nativeFormat === true;

      let upstreamBody = body;
      try {
        const parsed = JSON.parse(body);
        if (!parsed.model || parsed.model === 'auto') {
          parsed.model = model;
        }
        upstreamBody = JSON.stringify(parsed);
      } catch {}

      if (isOllama) upstreamBody = toOllamaBody(upstreamBody);

      let upstreamPath = isOllama ? toOllamaPath(openaiPath) : openaiPath;
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
        rotator.markModelLimited(model, retryAfter ? parseInt(retryAfter, 10) : 3600);
        tried.push(`${provider}/${model}(429)`);
        console.log(`[auto-free]     ${provider}/${model} rate limited → trying next`);
        providerTried++;
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        rotator.markLimited(key, 30 * 24 * 60 * 60);
        tried.push(`${provider}/${model}(${res.status} invalid key)`);
        console.log(`[auto-free]     ${provider}/${model} invalid key → trying next`);
        providerTried++;
        continue;
      }

      if (FATAL_STATUSES.has(res.status)) {
        tried.push(`${provider}/${model}(${res.status})`);
        console.log(`[auto-free]     ${provider}/${model} → ${res.status}, trying next`);
        providerTried++;
        continue;
      }

      const totalTime = Date.now() - overallStartTime;
      console.log(`[auto-free]   ✓ ${provider}/${model} succeeded in ${totalTime}ms (tried: ${providerTried} key-model pairs)`);
      const responseHeaders: Record<string, string> = { 'content-type': 'application/json' };
      res.headers.forEach((v, k) => { if (k !== 'content-type') responseHeaders[k] = v; });

      return { status: res.status, body: responseBody, headers: responseHeaders, usedProvider: provider, usedModel: model };
    }

    console.log(`[auto-free]   ${provider}: exhausted all free model/key combinations`);
  }

  console.log(`[auto-free] All free models exhausted, falling back to paid models`);
  const fallbackResult = await forwardAuto(openaiPath, method, body, priorityType);
  return fallbackResult;
}
