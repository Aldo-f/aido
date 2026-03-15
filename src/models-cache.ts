import { PROVIDER_CONFIGS, type Provider } from './detector.js';

interface ModelLimit {
  context?: number;
  input?: number;
  output?: number;
}

interface ProviderModels {
  [modelId: string]: {
    limit?: ModelLimit;
    reasoning?: boolean;
    tool_call?: boolean;
  };
}

interface ProviderData {
  models: ProviderModels;
}

interface ModelsDevCache {
  data: { [provider: string]: ProviderData };
  fetchedAt: number;
}

const CACHE_TTL = 24 * 60 * 60 * 1000;

let cache: ModelsDevCache | null = null;

export async function fetchModelsDev(): Promise<{ [provider: string]: ProviderData }> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return cache.data;
  }

  try {
    const res = await fetch('https://models.dev/api.json');
    const json = await res.json();
    cache = { data: json, fetchedAt: Date.now() };
    return json;
  } catch {
    return {};
  }
}

export function getModelLimit(provider: string, model: string): ModelLimit | null {
  if (!cache?.data?.[provider]?.models?.[model]?.limit) {
    return null;
  }
  return cache.data[provider].models[model].limit!;
}

export function hasReasoning(provider: string, model: string): boolean {
  return cache?.data?.[provider]?.models?.[model]?.reasoning ?? false;
}
