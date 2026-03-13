import { PROVIDER_CONFIGS, type Provider } from './detector.js';
import { getRotator } from './rotator.js';
import { logRequest } from './db.js';
import { forwardAuto, type PriorityType } from './auto.js';
import { routeAidoModel } from './models/router.js';

export interface RunOptions {
  provider: Provider | 'auto';
  model?: string;
  stream?: boolean;
}

// Default free models per provider
const DEFAULT_MODELS: Record<Provider, string> = {
  zen: 'big-pickle',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  groq: 'llama-3.1-8b-instant',
  google: 'gemini-1.5-flash',
  ollama: 'llama3',
  'ollama-local': 'qwen3:8b',
};

// All known free models on OpenCode Zen (from /zen/v1/models)
export const ZEN_FREE_MODELS = [
  'big-pickle',
  'mimo-v2-flash-free',
  'nemotron-3-super-free',
  'minimax-m2.5-free',
] as const;

export async function run(prompt: string, opts: RunOptions): Promise<void> {
  const { provider, model, stream = false } = opts;

  if (provider === 'auto') {
    const modelName = model ?? 'auto';
    const route = routeAidoModel(modelName);
    const priorityType: PriorityType = route.priorityType ?? 'auto';
    
    const body = JSON.stringify({
      model: route.model,
      stream,
      messages: [{ role: 'user', content: prompt }],
    });
    const result = await forwardAuto('/v1/chat/completions', 'POST', body, priorityType);

    if (result.status === 503) {
      console.error(`[run] All providers exhausted: ${result.body}`);
      process.exit(1);
    }

    if (result.status !== 200) {
      console.error(`[run] Error ${result.status}: ${result.body}`);
      process.exit(1);
    }

    const json = JSON.parse(result.body) as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? '(no response)';
    console.log(`[response] (${result.usedProvider}/${result.usedModel})\n${content}`);
    return;
  }

  const rotator = getRotator(provider);
  const key = rotator.next();

  if (!key) {
    console.error(`[run] No available API keys for provider: ${provider}`);
    process.exit(1);
  }

  const config = PROVIDER_CONFIGS[provider];
  const url = `${config.baseUrl}/chat/completions`;
  const selectedModel = model ?? DEFAULT_MODELS[provider];

  console.log(`[run] Provider: ${provider} | Model: ${selectedModel} | Key: ...${key.slice(-8)}`);
  console.log(`[run] Prompt: "${prompt}"\n`);

  const body = JSON.stringify({
    model: selectedModel,
    stream,
    messages: [{ role: 'user', content: prompt }],
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...config.authHeader(key),
      },
      body,
    });
  } catch (err) {
    const msg = (err as NodeJS.ErrnoException).code === 'EAI_AGAIN' || (err as NodeJS.ErrnoException).code === 'ENOTFOUND'
      ? `Could not reach ${provider} API. Are you online?`
      : `Network error: ${(err as Error).message}`;
    console.error(`[run] ✗ ${msg}`);
    process.exit(1);
  }

  logRequest(key, provider, res.status);

  if (res.status === 429) {
    rotator.markLimited(key);
    console.error(`[run] Rate limited. Key ...${key.slice(-8)} marked. Try again.`);
    process.exit(1);
  }

  if (!res.ok) {
    const err = await res.text();
    console.error(`[run] Error ${res.status}: ${err}`);
    process.exit(1);
  }

  if (stream) {
    // Stream SSE output
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) return;

    process.stdout.write('[response] ');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const json = JSON.parse(line.slice(6));
          const delta = json.choices?.[0]?.delta?.content ?? '';
          process.stdout.write(delta);
        } catch { /* skip malformed chunks */ }
      }
    }
    console.log();
  } else {
    const json = await res.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? '(no response)';
    console.log(`[response]\n${content}`);
  }
}
