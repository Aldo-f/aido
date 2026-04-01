import { type Provider } from './detector.js';
import { getRotator } from './rotator.js';
import { logRequest } from './db.js';
import { PROVIDER_CONFIGS } from './detector.js';
import { safeFetch } from './safe-fetch.js';
import { FATAL_STATUSES } from './http-utils.js';

export interface TryKeyResult {
  status: 'success' | 'rate_limited' | 'invalid_key' | 'fatal' | 'network_error';
  response?: Response;
  key?: string;
  error?: string;
}

export async function tryKey(
  provider: Provider,
  key: string,
  model: string,
  url: string,
  method: string,
  baseHeaders: Record<string, string>,
  body: string,
): Promise<TryKeyResult> {
  const rotator = getRotator(provider);
  const config = PROVIDER_CONFIGS[provider];
  const headers = { ...baseHeaders, ...config.authHeader(key) };

  try {
    const res = await safeFetch(url, {
      method,
      headers,
      body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
    });

    const status = res.status;

    if (status === 429) {
      const retryAfter = res.headers.get('retry-after');
      rotator.markModelLimited(model, retryAfter ? parseInt(retryAfter, 10) : 3600);
      logRequest(key, provider, status, model);
      return { status: 'rate_limited', response: res, key };
    }

    if (status === 401 || status === 403) {
      rotator.markLimited(key, 30 * 24 * 60 * 60);
      logRequest(key, provider, status, model);
      return { status: 'invalid_key', response: res, key };
    }

    if (FATAL_STATUSES.has(status)) {
      logRequest(key, provider, status, model);
      return { status: 'fatal', response: res, key };
    }

    logRequest(key, provider, status, model);
    return { status: 'success', response: res, key };

  } catch (err) {
    return { status: 'network_error', error: (err as Error).message, key };
  }
}

export async function tryWithKeyRotation(
  provider: Provider,
  model: string,
  url: string,
  method: string,
  baseHeaders: Record<string, string>,
  body: string,
): Promise<{ res: Response; key: string }> {
  const rotator = getRotator(provider);
  const availableKeys = rotator.availableKeys();

  if (availableKeys.length === 0) {
    throw new Error(`No API keys available for ${provider}`);
  }

  for (const key of availableKeys) {
    const result = await tryKey(provider, key, model, url, method, baseHeaders, body);

    if (result.status === 'success' && result.response) {
      return { res: result.response, key };
    }

    if (result.status === 'rate_limited') {
      console.log(`[rotation] ${provider}/${model} rate limited, trying next key`);
      continue;
    }

    if (result.status === 'invalid_key') {
      console.log(`[rotation] ${provider}: key ...${key.slice(-8)} invalid, trying next`);
      continue;
    }

    if (result.status === 'network_error') {
      console.log(`[rotation] ${provider}: key ...${key.slice(-8)} network error: ${result.error}`);
      continue;
    }

    if (result.status === 'fatal' && result.response) {
      const errText = await result.response.text();
      throw new Error(`${provider} returned ${result.response.status}: ${errText}`);
    }
  }

  throw new Error(`All keys for ${provider} failed or are rate limited`);
}
