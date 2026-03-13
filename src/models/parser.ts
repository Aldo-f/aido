import type { Provider } from '../detector.js';

export type AidoCategory = 'auto' | 'cloud' | 'local' | 'provider';

export interface ParsedAidoModel {
  category: AidoCategory;
  provider: Provider | null;
  model: string | null;
}

const KNOWN_CATEGORIES = ['auto', 'cloud', 'local'] as const;
const KNOWN_PROVIDERS: Provider[] = ['zen', 'openai', 'anthropic', 'groq', 'google', 'ollama', 'ollama-local'];

export function parseAidoModel(path: string): ParsedAidoModel {
  if (!path || typeof path !== 'string') {
    throw new Error("Path is required");
  }
  
  const normalized = path.trim();
  
  if (!normalized) {
    throw new Error("Path cannot be empty or whitespace");
  }
  
  const cleanPath = normalized.replace(/^\/+|\/+$/g, '');
  
  if (!cleanPath.toLowerCase().startsWith('aido')) {
    throw new Error(`Invalid aido path: must start with 'aido/'`);
  }
  
  const remainder = cleanPath.slice(4);
  
  if (!remainder) {
    throw new Error("Missing category after 'aido/'. Use: aido/auto, aido/cloud, or aido/local");
  }
  
  if (!remainder.startsWith('/')) {
    throw new Error("Missing category after 'aido/'. Use: aido/auto, aido/cloud, or aido/local");
  }
  
  const parts = remainder.slice(1).split('/').filter(Boolean);
  
  if (parts.length === 0) {
    throw new Error("Missing category after 'aido/'. Use: aido/auto, aido/cloud, or aido/local");
  }
  
  const categoryOrProvider = parts[0].toLowerCase();
  
  if (KNOWN_CATEGORIES.includes(categoryOrProvider as typeof KNOWN_CATEGORIES[number])) {
    const category = categoryOrProvider as 'auto' | 'cloud' | 'local';
    
    if (parts.length === 1) {
      return { category, provider: null, model: null };
    }
    
    if (category === 'auto' && parts.length > 1) {
      throw new Error(`Invalid: 'aido/auto' does not accept a model name. Use 'aido/cloud/<model>' or 'aido/local/<model>' instead.`);
    }
    
    const model = parts.slice(1).join('/');
    return { category, provider: null, model };
  }
  
  if (KNOWN_PROVIDERS.includes(categoryOrProvider as Provider)) {
    const provider = categoryOrProvider as Provider;
    
    if (parts.length === 1) {
      throw new Error(`Missing model name for provider '${provider}'. Use: aido/${provider}/<model>`);
    }
    
    const model = parts.slice(1).join('/');
    return { category: 'provider', provider, model };
  }
  
  throw new Error(`Unknown category or provider: '${categoryOrProvider}'. Use: aido/auto, aido/cloud, aido/local, or aido/<provider>/<model>`);
}

export function isAidoPath(path: string): boolean {
  if (!path || typeof path !== 'string') {
    return false;
  }
  return path.trim().replace(/^\/+|\/+$/g, '').toLowerCase().startsWith('aido');
}

/**
 * Parse a model name from request body.
 * Handles formats: aido/auto, aido/cloud, aido/local, aido/zen/big-pickle, aido/ollama/qwen3:8b
 */
export function parseAidoModelName(modelName: string): ParsedAidoModel {
  if (!modelName || typeof modelName !== 'string') {
    throw new Error("Model name is required");
  }

  const trimmed = modelName.trim();

  if (!trimmed) {
    throw new Error("Model name cannot be empty");
  }

  // Add 'aido/' prefix if not present, since parseAidoModel expects it
  const path = trimmed.toLowerCase().startsWith('aido/') ? trimmed : `aido/${trimmed}`;

  return parseAidoModel(path);
}
