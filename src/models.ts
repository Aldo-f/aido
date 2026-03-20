import { PROVIDER_CONFIGS, type Provider } from './detector.js';
import { getDb } from './db.js';
import { mergeWithCapabilities, type ModelCapabilities } from './model-capabilities.js';
import { identifyFreeModels, type RawModel } from './free-discovery.js';

export interface ModelInfo {
  id: string;
  owned_by?: string;
  isFree?: boolean;
  capabilities?: ModelCapabilities;
}

// Providers with a models listing endpoint
const MODELS_ENDPOINT_PROVIDERS: Provider[] = ['zen', 'openai', 'groq', 'ollama', 'ollama-local'];

// Cache TTL: 1 hour
const CACHE_TTL_MS = 60 * 60 * 1000;

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

const MODELS_DEV_CACHE_TTL = 24 * 60 * 60 * 1000;
let modelsDevCache: ModelsDevCache | null = null;

export async function fetchModelsDev(): Promise<{ [provider: string]: ProviderData }> {
  if (modelsDevCache && Date.now() - modelsDevCache.fetchedAt < MODELS_DEV_CACHE_TTL) {
    return modelsDevCache.data;
  }

  try {
    const res = await fetch('https://models.dev/api.json');
    const json = await res.json();
    modelsDevCache = { data: json, fetchedAt: Date.now() };
    return json;
  } catch {
    return {};
  }
}

export function getModelLimit(provider: string, model: string): ModelLimit | null {
  if (!modelsDevCache?.data?.[provider]?.models?.[model]?.limit) {
    return null;
  }
  return modelsDevCache.data[provider].models[model].limit!;
}

export function hasReasoning(provider: string, model: string): boolean {
  return modelsDevCache?.data?.[provider]?.models?.[model]?.reasoning ?? false;
}

function getCached(provider: string, keyHint: string): ModelInfo[] | null {
  const db = getDb();
  const now = Date.now();
  const cutoff = now - CACHE_TTL_MS;
  
  const rows = db
    .prepare('SELECT model_id, model_name, discovered_at, expires_at FROM models WHERE provider = ? AND discovered_at > ?')
    .all(provider, cutoff) as Array<{ model_id: string; model_name: string; discovered_at: number; expires_at: number }>;
  
  if (rows.length === 0) return null;
  
  return rows.map(row => ({
    id: row.model_id,
    owned_by: provider,
  }));
}

function setCache(provider: string, keyHint: string, models: ModelInfo[]): void {
  const db = getDb();
  const now = Date.now();
  const expiresAt = now + CACHE_TTL_MS;
  
  db.prepare('DELETE FROM models WHERE provider = ?').run(provider);
  
  const stmt = db.prepare(`
    INSERT INTO models (provider, model_id, model_name, is_free, discovered_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  for (const model of models) {
    stmt.run(
      provider,
      model.id,
      model.id,
      model.isFree ? 1 : 0,
      now,
      expiresAt
    );
  }
}

export async function fetchModels(
  provider: Provider,
  key: string,
  force = false,
): Promise<ModelInfo[]> {
  const keyHint = key.slice(-8);

  if (!force) {
    const cached = getCached(provider, keyHint);
    if (cached) return cached;
  }

  if (!MODELS_ENDPOINT_PROVIDERS.includes(provider)) {
    return [{ id: `(${provider} has no /models endpoint)` }];
  }

  const config = PROVIDER_CONFIGS[provider];
  // Ollama Cloud: /api/tags — others: /models
  let url: string;
  if (provider === 'ollama') {
    url = `${config.baseUrl}/tags`;
  } else {
    url = `${config.baseUrl}/models`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { ...config.authHeader(key) },
    });
  } catch (err) {
    throw new Error(`Could not reach ${provider} API: ${(err as Error).message}`);
  }

  if (!res.ok) {
    throw new Error(`${provider} /models returned ${res.status}`);
  }

  const json = await res.json() as {
    data?: Array<{ id: string; owned_by?: string }>;
    models?: Array<{ name: string; model?: string }>;
  };

  let models: ModelInfo[];
  if (json.models) {
    models = json.models.map((m) => {
      const modelId = m.name?.replace('models/', '') ?? m.model ?? '?';
      return {
        id: modelId,
        owned_by: provider,
        capabilities: mergeWithCapabilities(modelId),
      };
    });
  } else {
    models = (json.data ?? []).map((m) => {
      return {
        id: m.id,
        owned_by: m.owned_by,
        capabilities: mergeWithCapabilities(m.id),
      };
    });
  }

  const rawModels: RawModel[] = models.map(m => ({ id: m.id }));
  const identified = identifyFreeModels(provider, rawModels);
  const freeMap = new Map(identified.map(m => [m.id, m.isFree]));
  for (const model of models) {
    model.isFree = freeMap.get(model.id) ?? false;
  }

  setCache(provider, keyHint, models);
  return models;
}

export async function showModels(provider: Provider, key: string, force: boolean): Promise<void> {
  const models = await fetchModels(provider, key, force);

  if (models.length === 0) {
    return;
  }

  const groups = new Map<string, ModelInfo[]>();
  for (const m of models) {
    const group = m.owned_by ?? provider;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(m);
  }

  for (const [group, modelList] of groups) {
    try {
      console.log(`  [${group}]`);
      for (const m of modelList) {
        const tag = m.isFree ? ' [free]' : '';
        console.log(`    ${m.id}${tag}`);
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'EPIPE') {
        return;
      }
      throw err;
    }
  }

  const freeCount = models.filter(m => m.isFree).length;
  const paidCount = models.length - freeCount;
  try {
    console.log(`\n  ${models.length} models total (${freeCount} free, ${paidCount} paid)`);
    console.log('  (cached for 1h — use --sync to refresh)\n');
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EPIPE') {
      return;
    }
    throw err;
  }
}
