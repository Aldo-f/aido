// Free model discovery module
// Automatically queries provider APIs to discover available free models

import { PROVIDER_CONFIGS, type Provider } from './detector';
import { loadKeysForProvider } from './rotator';
import { getFreeModels, invalidateCache, saveFreeModels } from './db';

/**
 * Represents a discovered free model
 */
export interface FreeModel {
  /** Model ID from the provider API */
  id: string;
  /** Human-readable model name */
  name: string;
  /** Provider this model belongs to */
  provider: Provider;
  /** Whether this model is confirmed as free tier */
  isFree: boolean;
  /** Timestamp when this model was discovered */
  discoveredAt: number;
  /** Timestamp when this cache entry expires */
  expiresAt: number;
}

/**
 * Raw model data from provider API response
 */
export interface RawModel {
  id: string;
  name?: string;
  object?: string;
  owned_by?: string;
  // Additional provider-specific fields
  [key: string]: unknown;
}

/**
 * Provider API response structure
 */
export interface ProviderModels {
  object: string;
  data: RawModel[];
}

/**
 * Discovery result including free and paid models
 */
export interface DiscoveryResult {
  provider: Provider;
  freeModels: FreeModel[];
  paidModels: FreeModel[];
  totalModels: number;
  discoveredAt: number;
}

/**
 * Fetch models from a provider's API
 * @param provider - The provider to query
 * @returns Promise resolving to raw model data from the provider
 */
export async function fetchModels(provider: Provider): Promise<RawModel[]> {
  const config = PROVIDER_CONFIGS[provider];
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const keys = loadKeysForProvider(provider);
  if (keys.length === 0) {
    throw new Error(`No keys configured for provider: ${provider}`);
  }

  const key = keys[0];
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...config.authHeader(key),
  };

  const baseUrl = config.baseUrl;
  const modelsUrl = `${baseUrl}/models`;

  // AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch models from ${provider}: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as ProviderModels;
    return data.data ?? [];
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Timeout fetching models from ${provider} after 30 seconds`);
    }
    throw error;
  }
}

/**
 * Discover free models for a given provider
 * @param provider - The provider to query
 * @returns Promise resolving to array of free models
 */
export async function discoverFreeModels(provider: Provider): Promise<FreeModel[]> {
  // Check cache first
  const cachedModels = getFreeModels(provider);
  if (cachedModels.length > 0) {
    return cachedModels as FreeModel[];
  }
  
  // Cache miss - fetch from provider API
  const rawModels = await fetchModels(provider);
  if (rawModels.length === 0) {
    return [];
  }
  
  // Identify free models
  const freeModels = identifyFreeModels(provider, rawModels);
  
  // Save to cache
  if (freeModels.length > 0) {
    saveFreeModels(provider, freeModels);
  }
  
  return freeModels;
}

/**
 * Discover models for all configured providers
 * @returns Promise resolving to map of provider -> free models
 */
export async function discoverAllFreeModels(): Promise<Map<Provider, FreeModel[]>> {
  const providers = Object.keys(PROVIDER_CONFIGS) as Provider[];
  const configuredProviders = providers.filter(p => loadKeysForProvider(p).length > 0);

  // Fetch models for all providers in parallel
  const results = await Promise.all(
    configuredProviders.map(async (provider) => {
      try {
        const freeModels = await discoverFreeModels(provider);
        return [provider, freeModels] as const;
      } catch (error) {
        console.error(`Failed to discover free models for ${provider}: ${error}`);
        return [provider, [] as FreeModel[]] as const;
      }
    })
  );

  return new Map(results);
}

/**
 * Check if cached free models are expired for a provider
 * @param provider - The provider to check
 * @returns true if cache is expired or missing
 */
export function isCacheExpired(provider: Provider): boolean {
  // This will be implemented in Task 5
  return true;
}

/**
 * Track last refresh time per provider to avoid hammering APIs
 */
const lastRefreshTime = new Map<Provider, number>();

/**
 * Minimum interval between refreshes (30 minutes)
 */
const REFRESH_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Manually refresh the free model cache for a provider
 * @param provider - The provider to refresh
 */
export async function refreshFreeModelCache(provider: Provider): Promise<void> {
  // Check cooldown to avoid hammering provider APIs
  const lastRefresh = lastRefreshTime.get(provider) ?? 0;
  if (Date.now() - lastRefresh < REFRESH_COOLDOWN_MS) {
    return; // Skip if refreshed recently
  }

  // Invalidate existing cache for this provider
  invalidateCache(provider);

  // Fetch fresh models (will bypass empty cache and call provider API)
  await discoverFreeModels(provider);

  // Update last refresh timestamp
  lastRefreshTime.set(provider, Date.now());
}

/**
 * Manually refresh the free model cache for all configured providers
 */
export async function refreshAllFreeModelCaches(): Promise<void> {
  const providers = Object.keys(PROVIDER_CONFIGS) as Provider[];
  const configuredProviders = providers.filter(p => loadKeysForProvider(p).length > 0);

  await Promise.all(
    configuredProviders.map(async (provider) => {
      try {
        await refreshFreeModelCache(provider);
      } catch {
        console.error(`Failed to refresh cache for ${provider}`);
      }
    })
  );
}

// ─── Free Model Identification Rules ───────────────────────────────────────────

// Free model patterns for Zen (models ending with -free)
const ZEN_FREE_PATTERN = /-free$/;

// Special free models on Zen that don't follow the -free naming convention
const ZEN_SPECIAL_FREE_MODELS = new Set(['big-pickle']);

// Free model patterns for OpenRouter (models ending with :free)
const OPENROUTER_FREE_PATTERN = /:free$/;

// Free Gemini models on Google (Flash models have free tier)
const GOOGLE_FREE_PATTERNS = [
  /gemini-[\d.]+-flash/i,
  /gemini-[\d.]+-flash-lite/i,
  /gemini-exp/i,
];

// Free model patterns for Groq (Groq offers free access to models)
const GROQ_FREE_PATTERNS = [
  /^llama-[\d.]+-/,
  /^mixtral-/,
  /^gemma[\d]?-/,
  /^qwen-/,
];

// Cache provider check functions for performance
const PROVIDER_CHECKERS: Record<Provider, (modelId: string) => boolean> = {
  zen: (modelId) => ZEN_SPECIAL_FREE_MODELS.has(modelId) || ZEN_FREE_PATTERN.test(modelId),
  openrouter: (modelId) => OPENROUTER_FREE_PATTERN.test(modelId),
  google: (modelId) => GOOGLE_FREE_PATTERNS.some(pattern => pattern.test(modelId)),
  groq: (modelId) => GROQ_FREE_PATTERNS.some(pattern => pattern.test(modelId)),
  'ollama-local': () => true, // Local Ollama is always free
  ollama: () => false, // Ollama Cloud: unknown free status, default to false
  openai: () => false, // OpenAI has no free tier
  anthropic: () => false, // Anthropic has no free tier
};

// Default cache duration (1 hour)
const DEFAULT_CACHE_DURATION_MS = 60 * 60 * 1000;

export function identifyFreeModels(provider: Provider, models: RawModel[]): FreeModel[] {
  if (models.length === 0) {
    return [];
  }

  const now = Date.now();
  const checker = PROVIDER_CHECKERS[provider] || (() => false);
  const expiresAt = now + DEFAULT_CACHE_DURATION_MS;

  return models.map(model => ({
    id: model.id,
    name: model.name ?? model.id,
    provider,
    isFree: checker(model.id),
    discoveredAt: now,
    expiresAt,
  }));
}
