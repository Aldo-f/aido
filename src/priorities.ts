import type { Provider } from './detector.js';

export interface ProviderModel {
  provider: Provider;
  model: string;
}

export const PRIORITIES = {
    auto: [
      { provider: 'opencode' as Provider, model: 'big-pickle' },
      { provider: 'ollama-local' as Provider, model: 'qwen3:8b' },
      { provider: 'ollama' as Provider, model: 'glm-5:cloud' },
      { provider: 'groq' as Provider, model: 'llama-3.1-8b-instant' },
      { provider: 'openai' as Provider, model: 'gpt-4o-mini' },
      { provider: 'anthropic' as Provider, model: 'claude-haiku-4-5' },
      { provider: 'openrouter' as Provider, model: 'nvidia/nemotron-3-super-120b-a12b:free' },
    ] as ProviderModel[],

    cloud: [
      { provider: 'opencode' as Provider, model: 'big-pickle' },
      { provider: 'groq' as Provider, model: 'llama-3.1-8b-instant' },
      { provider: 'openai' as Provider, model: 'gpt-4o-mini' },
      { provider: 'anthropic' as Provider, model: 'claude-haiku-4-5' },
      { provider: 'ollama-local' as Provider, model: 'glm-5:cloud' },
      { provider: 'openrouter' as Provider, model: 'nvidia/nemotron-3-super-120b-a12b:free' },
    ] as ProviderModel[],

    local: [
      { provider: 'ollama-local' as Provider, model: 'qwen3:8b' },
    ] as ProviderModel[],
} as const;

export type PriorityType = keyof typeof PRIORITIES;
