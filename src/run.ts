import { PROVIDER_CONFIGS, applyModelPrefix, type Provider } from './detector.js';
import { getRotator } from './rotator.js';
import { getFreeModels, getModel, getAllModels } from './db.js';
import { forwardAuto, type PriorityType } from './auto.js';
import { routeAidoModel } from './models/router.js';
import { fetchModels } from './models.js';
import { tryWithKeyRotation } from './key-rotation.js';

export interface RunOptions {
  provider: Provider | 'auto';
  model?: string;
  stream?: boolean;
  strategy?: 'free' | 'paid' | 'both';
}

const DEFAULT_MODELS: Record<Provider, string> = {
   opencode: 'big-pickle',
   openai: 'gpt-4o-mini',
   anthropic: 'claude-haiku-4-5-20251001',
   groq: 'llama-3.1-8b-instant',
   google: 'gemini-1.5-flash',
   ollama: 'llama3',
   'ollama-local': 'qwen3:8b',
   openrouter: 'nvidia/nemotron-3-super-120b-a12b:free',
 };

async function handleStream(res: Response, provider: Provider, model: string): Promise<void> {
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
      } catch {}
    }
  }
  console.log();
}

async function handleNonStream(res: Response, provider: Provider, model: string): Promise<void> {
  const json = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? '(no response)';
  console.log(`[response] (${provider}/${model})\n${content}`);
}

async function makeRequest(
  provider: Provider,
  model: string,
  prompt: string,
  stream: boolean,
): Promise<{ res: Response; key: string }> {
  const config = PROVIDER_CONFIGS[provider];
  const url = `${config.baseUrl}/chat/completions`;
  const prefixedModel = applyModelPrefix(provider, model);
  const body = JSON.stringify({ model: prefixedModel, stream, messages: [{ role: 'user', content: prompt }] });
  const baseHeaders = { 'content-type': 'application/json' };

  return tryWithKeyRotation(provider, model, url, 'POST', baseHeaders, body);
}

export async function run(prompt: string, opts: RunOptions): Promise<void> {
  const { provider, model, stream = false, strategy = 'both' } = opts;

  if (provider === 'auto') {
    const modelName = model ?? 'auto';
    const route = routeAidoModel(modelName);

    if (route.provider !== 'auto') {
      const specificProvider = route.provider as Provider;

      try {
        const { res } = await makeRequest(specificProvider, route.model, prompt, stream);
        if (stream) {
          await handleStream(res, specificProvider, route.model);
        } else {
          await handleNonStream(res, specificProvider, route.model);
        }
        return;
      } catch (err) {
        console.error(`[run] ${err}`);
        process.exit(1);
      }
    }

    const priorityType: PriorityType = route.priorityType ?? 'auto';
    const body = JSON.stringify({ model: route.model, stream, messages: [{ role: 'user', content: prompt }] });
    const result = await forwardAuto('/v1/chat/completions', 'POST', body, priorityType, route.model);

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

  const config = PROVIDER_CONFIGS[provider];
  const url = `${config.baseUrl}/chat/completions`;

  let modelsToTry: string[];

  if (model) {
    let modelInfo = getModel(provider, model);
    if (!modelInfo) {
      const rotator = getRotator(provider);
      const key = rotator.next();
      if (key) {
        console.log(`[run] Model '${model}' not found, fetching models from ${provider}...`);
        try {
          await fetchModels(provider, key);
          modelInfo = getModel(provider, model);
        } catch {}
      }

      if (!modelInfo) {
        console.error(`[run] Model '${model}' not found for provider '${provider}'`);
        console.error(`[run] Available models: ${getAllModels(provider).map(m => m.id).join(', ')}`);
        process.exit(1);
      }
    }
    modelsToTry = [model];
  } else {
    const allModels = getAllModels(provider);
    const freeModels = allModels.filter(m => m.isFree);
    const paidModels = allModels.filter(m => !m.isFree);

    if (strategy === 'free') {
      modelsToTry = freeModels.map(m => m.id);
    } else if (strategy === 'paid') {
      modelsToTry = paidModels.map(m => m.id);
    } else {
      modelsToTry = [...freeModels.map(m => m.id), ...paidModels.map(m => m.id)];
    }

    if (modelsToTry.length === 0) {
      modelsToTry = [DEFAULT_MODELS[provider]];
    }
  }

  const rotator = getRotator(provider);
  if (rotator.availableKeys().length === 0) {
    console.error(`[run] No available API keys for provider: ${provider}`);
    process.exit(1);
  }

  for (const selectedModel of modelsToTry) {
    const baseHeaders = { 'content-type': 'application/json' };
    const body = JSON.stringify({ model: selectedModel, stream, messages: [{ role: 'user', content: prompt }] });

    try {
      const { res } = await tryWithKeyRotation(provider, selectedModel, url, 'POST', baseHeaders, body);
      if (stream) {
        await handleStream(res, provider, selectedModel);
      } else {
        await handleNonStream(res, provider, selectedModel);
      }
      return;
    } catch (err) {
      console.log(`[run] ${err instanceof Error ? err.message : err}`);
    }
  }

  console.error(`[run] All models for ${provider} failed`);
  process.exit(1);
}
