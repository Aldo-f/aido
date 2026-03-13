import { PROVIDER_CONFIGS, type Provider } from './detector.js';
import { getDb } from './db.js';

export interface ModelInfo {
  id: string;
  owned_by?: string;
  free?: boolean; // true if input/output price is 0 (where known)
}

// Providers with a models listing endpoint
const MODELS_ENDPOINT_PROVIDERS: Provider[] = ['zen', 'openai', 'groq', 'ollama', 'ollama-local'];

// Cache TTL: 1 hour
const CACHE_TTL_MS = 60 * 60 * 1000;

function ensureModelsTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS models_cache (
      provider TEXT NOT NULL,
      key_hint TEXT NOT NULL,
      data     TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (provider, key_hint)
    )
  `);
}

function getCached(provider: string, keyHint: string): ModelInfo[] | null {
  ensureModelsTable();
  const row = getDb()
    .prepare('SELECT data, fetched_at FROM models_cache WHERE provider = ? AND key_hint = ?')
    .get(provider, keyHint) as { data: string; fetched_at: number } | undefined;

  if (!row) return null;
  if (Date.now() - row.fetched_at > CACHE_TTL_MS) return null;
  return JSON.parse(row.data) as ModelInfo[];
}

function setCache(provider: string, keyHint: string, models: ModelInfo[]): void {
  ensureModelsTable();
  getDb()
    .prepare(`
      INSERT INTO models_cache (provider, key_hint, data, fetched_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(provider, key_hint) DO UPDATE SET
        data = excluded.data,
        fetched_at = excluded.fetched_at
    `)
    .run(provider, keyHint, JSON.stringify(models), Date.now());
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
    // Google: {models: [{name: "models/gemini-1.5-pro", ...}]} or Ollama Cloud
    models = json.models.map((m) => ({
      id: m.name?.replace('models/', '') ?? m.model ?? '?',
      owned_by: provider,
    }));
  } else {
    models = (json.data ?? []).map((m) => ({ id: m.id, owned_by: m.owned_by }));
  }

  setCache(provider, keyHint, models);
  return models;
}

export async function showModels(provider: Provider, key: string, force: boolean): Promise<void> {
  console.log(`\nFetching models for ${provider} (key: ...${key.slice(-8)})${force ? ' [force sync]' : ''}...\n`);

  let models: ModelInfo[];
  try {
    models = await fetchModels(provider, key, force);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return;
  }

  if (models.length === 0) {
    console.log('  (no models returned)');
    return;
  }

  // Group by owned_by if present
  const groups = new Map<string, string[]>();
  for (const m of models) {
    const group = m.owned_by ?? provider;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(m.id);
  }

  for (const [group, ids] of groups) {
    console.log(`  [${group}]`);
    for (const id of ids) console.log(`    ${id}`);
  }

  console.log(`\n  ${models.length} models total`);
  console.log('  (cached for 1h — use --sync to refresh)\n');
}
