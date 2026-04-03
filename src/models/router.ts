import type { Provider } from '../detector.js';
import { AUTO_PRIORITY, type PriorityType } from '../auto.js';
import { PRIORITIES } from '../priorities.js';
import { parseAidoModelName, type ParsedAidoModel } from './parser.js';

export interface RouteResult {
  provider: Provider | 'auto';
  model: string;
  upstreamPath: string;
  isAuto: boolean;
  priorityType?: PriorityType;
}

const CLOUD_PRIORITY = PRIORITIES.cloud;
const LOCAL_PRIORITY = PRIORITIES.local;

const CACHE_TTL_MS = 60 * 60 * 1000;
let cloudModelsCache: string[] | null = null;
let cloudModelsCacheTime = 0;

const STATIC_LOCAL_CLOUD_MODELS = ['glm-5:cloud', 'kimi-k2.5:cloud', 'minimax-m2.5:cloud'];

async function fetchCloudModelsFromOllamaLocal(): Promise<string[]> {
  const ollamaLocalUrl = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  try {
    const res = await fetch(`${ollamaLocalUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const json = await res.json() as { models?: Array<{ name: string }> };
    const models = json.models ?? [];
    return models
      .map(m => m.name)
      .filter(name => name.endsWith(':cloud'));
  } catch {
    return [];
  }
}

export async function refreshCloudModels(): Promise<string[]> {
  const models = await fetchCloudModelsFromOllamaLocal();
  const allCloudModels = [...new Set([...STATIC_LOCAL_CLOUD_MODELS, ...models])];
  cloudModelsCache = allCloudModels;
  cloudModelsCacheTime = Date.now();
  return allCloudModels;
}

function getCloudModels(): string[] {
  const now = Date.now();
  if (cloudModelsCache && (now - cloudModelsCacheTime) < CACHE_TTL_MS) {
    return cloudModelsCache;
  }
  refreshCloudModels().catch(() => {});
  return cloudModelsCache ?? STATIC_LOCAL_CLOUD_MODELS;
}

const CLOUD_ONLY_MODELS: Record<string, string> = {
  'glm-5': 'glm-5:cloud',
  'kimi-k2.5': 'kimi-k2.5:cloud',
  'minimax-m2.5': 'minimax-m2.5:cloud',
};

function addCloudSuffix(model: string): string {
  return CLOUD_ONLY_MODELS[model] ?? model;
}

export function routeAidoModel(pathname: string): RouteResult {
  const parsed = parseAidoModelName(pathname);
  
  if (parsed.category === 'auto') {
    return {
      provider: 'auto',
      model: parsed.model ?? AUTO_PRIORITY[0].model,
      upstreamPath: '/v1/chat/completions',
      isAuto: true,
      priorityType: 'auto',
    };
  }
  
  if (parsed.category === 'cloud') {
    if (parsed.model) {
      if (getCloudModels().includes(parsed.model)) {
        return {
          provider: 'ollama-local',
          model: parsed.model,
          upstreamPath: '/v1/chat/completions',
          isAuto: false,
          priorityType: 'local',
        };
      }
      return {
        provider: 'auto',
        model: parsed.model,
        upstreamPath: '/v1/chat/completions',
        isAuto: true,
        priorityType: 'cloud',
      };
    }
    return {
      provider: 'auto',
      model: 'auto',
      upstreamPath: '/v1/chat/completions',
      isAuto: true,
      priorityType: 'cloud',
    };
  }
  
  if (parsed.category === 'local') {
    if (parsed.model) {
      return {
        provider: 'ollama-local',
        model: parsed.model,
        upstreamPath: '/v1/chat/completions',
        isAuto: false,
        priorityType: 'local',
      };
    }
    return {
      provider: LOCAL_PRIORITY[0].provider,
      model: LOCAL_PRIORITY[0].model,
      upstreamPath: '/v1/chat/completions',
      isAuto: true,
      priorityType: 'local',
    };
  }
  
  if (parsed.category === 'provider' && parsed.provider) {
    // If no model specified, return with isAuto=true so run.ts picks a free model
    if (!parsed.model) {
      return {
        provider: parsed.provider,
        model: 'auto',
        upstreamPath: '/v1/chat/completions',
        isAuto: true,
      };
    }
    const model = addCloudSuffix(parsed.model);
    return {
      provider: parsed.provider,
      model,
      upstreamPath: '/v1/chat/completions',
      isAuto: false,
    };
  }
  
  throw new Error('Invalid parsed result: missing provider or model');
}

export function getPriorityForCategory(category: ParsedAidoModel['category']): Array<{ provider: Provider; model: string }> {
  switch (category) {
    case 'auto':
      return AUTO_PRIORITY;
    case 'cloud':
      return CLOUD_PRIORITY;
    case 'local':
      return LOCAL_PRIORITY;
    case 'provider':
      return AUTO_PRIORITY;
    default:
      return AUTO_PRIORITY;
  }
}
