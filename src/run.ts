import { PROVIDER_CONFIGS, type Provider } from './detector.js';
import { getRotator } from './rotator.js';
import { logRequest, getFreeModels, getModel, getAllModels } from './db.js';
import { forwardAuto, type PriorityType } from './auto.js';
import { routeAidoModel } from './models/router.js';

export interface RunOptions {
  provider: Provider | 'auto';
  model?: string;
  stream?: boolean;
  strategy?: 'free' | 'paid' | 'both';
}

const DEFAULT_MODELS: Record<Provider, string> = {
  zen: 'big-pickle',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  groq: 'llama-3.1-8b-instant',
  google: 'gemini-1.5-flash',
  ollama: 'llama3',
  'ollama-local': 'qwen3:8b',
  openrouter: 'nvidia/nemotron-3-super-120b-a12b:free',
};

export async function run(prompt: string, opts: RunOptions): Promise<void> {
  const { provider, model, stream = false, strategy = 'both' } = opts;

  if (provider === 'auto') {
    const modelName = model ?? 'auto';
    const route = routeAidoModel(modelName);
    
    if (route.provider !== 'auto') {
      const specificProvider = route.provider as Provider;
      const rotator = getRotator(specificProvider);
      const key = rotator.next();
      
      if (!key) {
        console.error(`[run] No available API keys for provider: ${specificProvider}`);
        process.exit(1);
      }
      
      const config = PROVIDER_CONFIGS[specificProvider];
      const url = `${config.baseUrl}/chat/completions`;
      
      const body = JSON.stringify({
        model: route.model,
        stream,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...config.authHeader(key),
        },
        body,
      });
      
      logRequest(key, specificProvider, res.status);
      
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
      } else {
        const json = await res.json() as {
          choices: Array<{ message: { content: string } }>;
        };
        const content = json.choices?.[0]?.message?.content ?? '(no response)';
        console.log(`[response] (${specificProvider}/${route.model})\n${content}`);
      }
      return;
    }
    
    const priorityType: PriorityType = route.priorityType ?? 'auto';
    
    const body = JSON.stringify({
      model: route.model,
      stream,
      messages: [{ role: 'user', content: prompt }],
    });
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
    const modelInfo = getModel(provider, model);
    if (!modelInfo) {
      console.error(`[run] Model '${model}' not found for provider '${provider}'`);
      console.error(`[run] Available models: ${getAllModels(provider).map(m => m.id).join(', ')}`);
      process.exit(1);
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

  let lastError: Error | null = null;
  for (const selectedModel of modelsToTry) {
    const rotator = getRotator(provider);
    const key = rotator.next();

    if (!key) {
      console.error(`[run] No available API keys for provider: ${provider}`);
      process.exit(1);
    }

    console.log(`[run] Provider: ${provider} | Model: ${selectedModel} | Key: ...${key.slice(-8)}`);

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
      lastError = new Error(msg);
      continue;
    }

    logRequest(key, provider, res.status);

    if (res.status === 429) {
      rotator.markLimited(key);
      console.log(`[run] Rate limited. Key ...${key.slice(-8)} marked. Trying next model...`);
      continue;
    }

    if (!res.ok) {
      const err = await res.text();
      console.log(`[run] Error ${res.status}: ${err}. Trying next model...`);
      continue;
    }

    if (stream) {
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
    } else {
      const json = await res.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      const content = json.choices?.[0]?.message?.content ?? '(no response)';
      console.log(`[response] (${provider}/${selectedModel})\n${content}`);
    }
    return;
  }

  if (lastError) {
    console.error(`[run] ✗ ${lastError.message}`);
  } else {
    console.error(`[run] ✗ All models for ${provider} failed`);
  }
  process.exit(1);
}
