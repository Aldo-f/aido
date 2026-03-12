import type { Provider } from '../detector.js';
import { AUTO_PRIORITY } from '../auto.js';
import { parseAidoModelName, type ParsedAidoModel } from './parser.js';

export interface RouteResult {
  provider: Provider | 'auto';
  model: string;
  upstreamPath: string;
  isAuto: boolean;
}

const CLOUD_PRIORITY: Array<{ provider: Provider; model: string }> = [
  { provider: 'zen', model: 'big-pickle' },
  { provider: 'groq', model: 'llama3-8b-8192' },
  { provider: 'openai', model: 'gpt-4o-mini' },
  { provider: 'anthropic', model: 'claude-haiku-4-5' },
  { provider: 'google', model: 'gemini-2.0-flash' },
];

const LOCAL_PRIORITY: Array<{ provider: Provider; model: string }> = [
  { provider: 'ollama-local', model: 'qwen3:8b' },
];

const LOCAL_CLOUD_MODELS = ['glm-5:cloud', 'kimi-k2.5:cloud', 'minimax-m2.5:cloud'];

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
      model: AUTO_PRIORITY[0].model,
      upstreamPath: '/v1/chat/completions',
      isAuto: true,
    };
  }
  
  if (parsed.category === 'cloud') {
    if (parsed.model) {
      if (LOCAL_CLOUD_MODELS.includes(parsed.model)) {
        return {
          provider: 'ollama-local',
          model: parsed.model,
          upstreamPath: '/v1/chat/completions',
          isAuto: false,
        };
      }
      return {
        provider: 'zen',
        model: parsed.model,
        upstreamPath: '/v1/chat/completions',
        isAuto: true,
      };
    }
    return {
      provider: CLOUD_PRIORITY[0].provider,
      model: CLOUD_PRIORITY[0].model,
      upstreamPath: '/v1/chat/completions',
      isAuto: true,
    };
  }
  
  if (parsed.category === 'local') {
    if (parsed.model) {
      return {
        provider: 'ollama-local',
        model: parsed.model,
        upstreamPath: '/v1/chat/completions',
        isAuto: false,
      };
    }
    return {
      provider: LOCAL_PRIORITY[0].provider,
      model: LOCAL_PRIORITY[0].model,
      upstreamPath: '/v1/chat/completions',
      isAuto: true,
    };
  }
  
  if (parsed.category === 'provider' && parsed.provider && parsed.model) {
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
