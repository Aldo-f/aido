export interface ModelCapabilities {
  context?: number;
  input?: number;
  output?: number;
  allows?: string[];
}

const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  // Claude models
  'claude-opus-4-6': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'claude-opus-4-5': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'claude-opus-4-1': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'claude-opus-4': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'claude-sonnet-4-6': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'claude-sonnet-4-5': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'claude-sonnet-4': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'claude-3-5-haiku': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'claude-haiku-4-5': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },

  // GPT-5 models
  'gpt-5.4-pro': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'gpt-5.4': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'gpt-5.3-codex-spark': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'code'] },
  'gpt-5.3-codex': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'code'] },
  'gpt-5.2': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'gpt-5.2-codex': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'code'] },
  'gpt-5.1': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'gpt-5.1-codex-max': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'code'] },
  'gpt-5.1-codex': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'code'] },
  'gpt-5.1-codex-mini': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'code'] },
  'gpt-5': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'gpt-5-codex': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'code'] },
  'gpt-5-nano': { context: 200000, input: 200000, output: 100000, allows: ['text'] },

  // Gemini models
  'gemini-3.1-pro': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf', 'video'] },
  'gemini-3-pro': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf', 'video'] },
  'gemini-3-flash': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf', 'video'] },

  // GLM models
  'glm-5': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'glm-4.7': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'glm-4.6': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },

  // MiniMax models
  'minimax-m2.5': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'minimax-m2.5-free': { context: 200000, input: 200000, output: 64000, allows: ['reasoning', 'text'] },
  'minimax-m2.1': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },

  // Kimi models
  'kimi-k2.5': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'kimi-k2': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text', 'image', 'pdf'] },
  'kimi-k2-thinking': { context: 200000, input: 200000, output: 100000, allows: ['reasoning', 'text'] },

  // Free models
  'big-pickle': { context: 200000, input: 200000, output: 64000, allows: ['reasoning', 'text'] },
  'nemotron-3-super-free': { context: 200000, input: 200000, output: 64000, allows: ['reasoning', 'text'] },
  'trinity-large-preview-free': { context: 200000, input: 200000, output: 64000, allows: ['reasoning', 'text'] },
  'mimo-v2-flash-free': { context: 200000, input: 200000, output: 64000, allows: ['reasoning', 'text'] },

  // Groq models
  'llama-3.3-70b-versatile': { context: 200000, input: 200000, output: 64000, allows: ['text', 'reasoning'] },
  'llama-3.1-70b-versatile': { context: 200000, input: 200000, output: 64000, allows: ['text', 'reasoning'] },
  'llama-3.1-8b-instant': { context: 200000, input: 200000, output: 64000, allows: ['text'] },
  'mixtral-8x7b-32768': { context: 200000, input: 200000, output: 64000, allows: ['text'] },
  'gemma2-9b-it': { context: 200000, input: 200000, output: 64000, allows: ['text'] },
};

export function getModelCapabilities(modelId: string): ModelCapabilities | null {
  return MODEL_CAPABILITIES[modelId] || null;
}

export function mergeWithCapabilities(
  modelId: string,
  base?: { context?: number; input?: number; output?: number }
): ModelCapabilities {
  const known = MODEL_CAPABILITIES[modelId];
  if (known) return known;

  return {
    context: base?.context ?? 200000,
    input: base?.input ?? 200000,
    output: base?.output ?? 64000,
    allows: ['text'],
  };
}
