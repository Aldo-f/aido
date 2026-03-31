// Key format → provider detection
// Order matters: most specific patterns first

export type Provider = 'opencode' | 'openai' | 'anthropic' | 'groq' | 'google' | 'ollama' | 'ollama-local' | 'openrouter';

export interface ProviderConfig {
  baseUrl: string;
  authHeader: (key: string) => Record<string, string>;
  /** If true, proxy must translate OpenAI ↔ provider format */
  nativeFormat?: boolean;
  /** If true, no API key is needed (e.g. local Ollama) */
  noAuth?: boolean;
  /** Prefix to prepend to model names when forwarding requests */
  modelPrefix?: string;
}

export const PROVIDER_CONFIGS: Record<Provider, ProviderConfig> = {
    opencode: {
      baseUrl: 'https://opencode.ai/zen/v1',
      authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    },
   openai: {
     baseUrl: 'https://api.openai.com/v1',
     authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
   },
   anthropic: {
     baseUrl: 'https://api.anthropic.com',
     authHeader: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
   },
   groq: {
     baseUrl: 'https://api.groq.com/openai/v1',
     authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
   },
   google: {
     baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
     authHeader: () => ({}),
   },
   openrouter: {
     baseUrl: 'https://openrouter.ai/api/v1',
     authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
   },
   // Ollama Cloud — uses /api/chat (not /v1/), proxy translates automatically
   ollama: {
     baseUrl: 'https://ollama.com/api',
     authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
     nativeFormat: true,
   },
   // Local Ollama — no auth, OpenAI-compatible, uses locally downloaded models
   // Configure OLLAMA_HOST in .env to override (default: http://localhost:11434)
   'ollama-local': {
     get baseUrl() {
       return (process.env.OLLAMA_HOST ?? 'http://localhost:11434') + '/v1';
     },
     authHeader: () => ({}), // no auth needed
     noAuth: true,
   },
 };

// OpenCode keys: sk- prefix, 60+ chars (e.g. sk-LXREfPN2uSYZ74VW4HLp...68 chars total)
// OpenAI keys: sk-proj-... or sk- + ~48 chars
// Anthropic: sk-ant-
// Ollama Cloud: 32 hex chars + '.' + alphanumeric (e.g. 3f7240e1a93345f0b7f91315c3860be7.qhdTl48Vsx7...)
// OpenRouter: sk-or-v1-...
const OLLAMA_KEY_RE = /^[a-f0-9]{32}\.[A-Za-z0-9_-]+$/;

const PATTERNS: Array<{ test: (key: string) => boolean; provider: Provider }> = [
    { test: (k) => OLLAMA_KEY_RE.test(k),                          provider: 'ollama'    },
    { test: (k) => k.startsWith('sk-ant-'),                        provider: 'anthropic' },
    { test: (k) => k.startsWith('sk-proj-'),                       provider: 'openai'    },
    { test: (k) => k.startsWith('sk-or-v1-'),                      provider: 'openrouter' },
    { test: (k) => k.startsWith('gsk_'),                           provider: 'groq'      },
    { test: (k) => k.startsWith('AIza'),                           provider: 'google'    },
    { test: (k) => k.startsWith('sk-') && k.length >= 60,          provider: 'opencode'  },
    { test: (k) => k.startsWith('sk-'),                            provider: 'openai'    },
];

export function detectProvider(key: string): Provider | null {
  for (const { test, provider } of PATTERNS) {
    if (test(key)) return provider;
  }
  return null;
}

export function applyModelPrefix(provider: Provider, model: string): string {
  const config = PROVIDER_CONFIGS[provider];
  return config.modelPrefix ? `${config.modelPrefix}${model}` : model;
}
