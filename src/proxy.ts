import 'dotenv/config';
import http from 'http';
import { PROVIDER_CONFIGS, applyModelPrefix, type Provider } from './detector.js';
import { getRotator } from './rotator.js';
import { logRequest } from './db.js';
import { toOllamaBody, fromOllamaResponse, toOllamaPath } from './ollama.js';
import { forwardAuto } from './auto.js';
import { routeAidoModel } from './models/router.js';
import { isPortInUse } from './port-check.js';
import { writePid, readPid, deletePid, isStale } from './daemon.js';
import { mergeWithCapabilities } from './model-capabilities.js';
import { safeFetch } from './safe-fetch.js';
import { extractResponseHeaders } from './http-utils.js';
import { type PriorityType } from './auto.js';

const DEFAULT_PROVIDER: Provider =
  (process.env.DEFAULT_PROVIDER as Provider) ?? 'opencode';

const PORT = parseInt(process.env.PROXY_PORT ?? '4141', 10);

function createEnrichedModel(m: Record<string, unknown>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const caps = mergeWithCapabilities(m.id as string);
  return {
    ...m,
    owned_by: 'aido',
    context: caps.context,
    input: caps.input,
    output: caps.output,
    allows: caps.allows,
    capabilities: caps,
    ...overrides,
  };
}

function enrichModelsWithCapabilities(responseBody: string): string {
  try {
    const json = JSON.parse(responseBody) as { data?: unknown[] };
    const models = json.data ?? [];
    if (Array.isArray(models) && models.length > 0) {
      const enrichedModels: Record<string, unknown>[] = [];
      for (const m of models) {
        enrichedModels.push(createEnrichedModel(m as Record<string, unknown>));
        enrichedModels.push(createEnrichedModel(m as Record<string, unknown>, { id: `aido/zen/${(m as Record<string, unknown>).id}` }));
      }
      json.data = enrichedModels;
      return JSON.stringify(json);
    }
    return responseBody;
  } catch {
    return responseBody;
  }
}

function transformResponseContent(responseBody: string): string {
  try {
    const json = JSON.parse(responseBody);
    if (json.choices && Array.isArray(json.choices)) {
      for (const choice of json.choices) {
        if (choice.message) {
          if (choice.message.reasoning && !choice.message.content) {
            choice.message.content = choice.message.reasoning;
          }
          if (choice.message.reasoning_details && Array.isArray(choice.message.reasoning_details)) {
            delete choice.message.reasoning_details;
          }
        }
      }
      return JSON.stringify(json);
    }
    return responseBody;
  } catch {
    return responseBody;
  }
}

export function resolveProvider(pathname: string, body?: string): { provider: Provider | 'auto'; upstreamPath: string; isAidoAuto?: boolean; model?: string; priorityType?: PriorityType } {
  if (body) {
    try {
      const parsed = JSON.parse(body);
      if (parsed.model && typeof parsed.model === 'string') {
        const route = routeAidoModel(parsed.model);
        return {
          provider: route.provider,
          upstreamPath: '/v1/chat/completions',
          isAidoAuto: route.isAuto,
          model: route.model,
          priorityType: route.priorityType,
        };
      }
    } catch {
      // Invalid JSON or no model field - fall through to default
    }
  }

  return { provider: DEFAULT_PROVIDER, upstreamPath: pathname };
}

async function forwardRequest(
  provider: Provider,
  path: string,
  method: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const rotator = getRotator(provider);
  let key = rotator.next();

  if (!key) {
    return {
      status: 503,
      body: JSON.stringify({ error: 'All API keys are rate limited. Try again later.' }),
      headers: { 'content-type': 'application/json' },
    };
  }

  const config = PROVIDER_CONFIGS[provider];
  const isOllama = config.nativeFormat === true;

  let upstreamPath = isOllama ? toOllamaPath(path) : path;
  if (config.baseUrl.endsWith('/v1') && upstreamPath.startsWith('/v1')) {
    upstreamPath = upstreamPath.slice(3);
  }

  // Parse body to potentially update model name for upstream request
  let upstreamBody = body;
  let modelForLogging = '';
  try {
    const parsed = JSON.parse(body);
    modelForLogging = parsed.model ?? '';

    if (parsed.model && typeof parsed.model === 'string') {
      const resolved = resolveProvider(path, body);
      if (resolved.model && resolved.provider !== 'auto') {
        parsed.model = applyModelPrefix(resolved.provider, resolved.model);
        upstreamBody = JSON.stringify(parsed);
      }
    }
  } catch { /* no body or not JSON */ }

  const upstreamBodyForOllama = isOllama && method !== 'GET' ? toOllamaBody(upstreamBody) : upstreamBody;
  const url = `${config.baseUrl}${upstreamPath}`;

  const forwardHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...config.authHeader(key),
  };

  const startTime = Date.now();
  let model = modelForLogging;

  // Loop instead of recursion for 429 handling
  while (true) {
    try {
      const res = await safeFetch(url, {
        method,
        headers: forwardHeaders,
        body: method !== 'GET' && method !== 'HEAD' ? upstreamBodyForOllama : undefined,
      });

      const rawBody = await res.text();
      const responseBody = isOllama ? fromOllamaResponse(rawBody) : rawBody;
      const latencyMs = Date.now() - startTime;
      logRequest(key, provider, res.status, model, 'proxy', latencyMs);

      if (res.status === 404 && provider === 'ollama-local') {
        let modelName = '(unknown)';
        try { modelName = (JSON.parse(upstreamBody) as { model?: string }).model ?? modelName; } catch { /* ok */ }
        return {
          status: 404,
          body: JSON.stringify({
            error: `Model "${modelName}" not found in local Ollama. Run: ollama pull ${modelName}`,
          }),
          headers: { 'content-type': 'application/json' },
        };
      }

      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        const cooldown = retryAfter ? parseInt(retryAfter, 10) : 3600;
        rotator.markLimited(key, cooldown);
        console.log(`[proxy] 429 on ${provider} key ...${key.slice(-8)} → rate limited, rotating`);

        key = rotator.next();
        if (!key) {
          return {
            status: 503,
            body: JSON.stringify({ error: 'All API keys are rate limited. Try again later.' }),
            headers: { 'content-type': 'application/json' },
          };
        }
        forwardHeaders['Authorization'] = config.authHeader(key).Authorization ?? forwardHeaders['Authorization'];
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        rotator.markInvalidKey(key);
        console.log(`[proxy] ${res.status} on ${provider} key ...${key.slice(-8)} → invalid key, rotating`);

        key = rotator.next();
        if (!key) {
          return {
            status: 401,
            body: JSON.stringify({ error: 'Invalid API key. Please check your credentials.' }),
            headers: { 'content-type': 'application/json' },
          };
        }
        forwardHeaders['Authorization'] = config.authHeader(key).Authorization ?? forwardHeaders['Authorization'];
        continue;
      }

      if (res.status === 402) {
        rotator.markQuotaExceeded(key);
        console.log(`[proxy] 402 on ${provider} key ...${key.slice(-8)} → quota exceeded, rotating`);

        key = rotator.next();
        if (!key) {
          return {
            status: 402,
            body: JSON.stringify({ error: 'Quota exceeded. Please check your payment method.' }),
            headers: { 'content-type': 'application/json' },
          };
        }
        forwardHeaders['Authorization'] = config.authHeader(key).Authorization ?? forwardHeaders['Authorization'];
        continue;
      }

      const responseHeaders = extractResponseHeaders(res);
      let enrichedBody = responseBody;
      if (path.includes('/v1/models')) {
        enrichedBody = enrichModelsWithCapabilities(responseBody);
      } else if (path.includes('/chat/completions')) {
        enrichedBody = transformResponseContent(responseBody);
      }

      return { status: res.status, body: enrichedBody, headers: responseHeaders };
    } catch (err) {
      console.log(`[proxy] network error on ${provider} key ...${key.slice(-8)} → ${(err as Error).message}, rotating`);

      key = rotator.next();
      if (!key) {
        return {
          status: 502,
          body: JSON.stringify({ error: `Upstream error: ${(err as Error).message}` }),
          headers: { 'content-type': 'application/json' },
        };
      }
      forwardHeaders['Authorization'] = config.authHeader(key).Authorization ?? forwardHeaders['Authorization'];
      continue;
    }
  }
}

export function createProxyServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const pathname = url.pathname;

    if (pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '1.0.0' }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString();

    const { provider, upstreamPath, isAidoAuto, priorityType } = resolveProvider(url.pathname + url.search, body);

    const result = provider === 'auto' || isAidoAuto
      ? await forwardAuto(upstreamPath, req.method ?? 'GET', body, priorityType ?? 'auto')
      : await forwardRequest(provider, upstreamPath, req.method ?? 'GET', req.headers as Record<string, string>, body);

    res.writeHead(result.status, result.headers);
    res.end(result.body);
  });
}

export async function startProxy(): Promise<void> {
  if (await isPortInUse(PORT)) {
    const existing = readPid();
    if (existing && !isStale()) {
      console.error(`[aido-proxy] Error: Port ${PORT} is already in use by PID ${existing.pid}.`);
      console.error(`           Is another aido-proxy instance running?`);
      console.error(`           To stop it: kill ${existing.pid}`);
      process.exit(1);
    }
    console.log(`[aido-proxy] Stale PID file found, removing...`);
    deletePid();

    if (await isPortInUse(PORT)) {
      console.error(`[aido-proxy] Error: Port ${PORT} is in use by another process.`);
      console.error(`           Please stop the existing service or use a different port.`);
      console.error(`           Current port: ${PORT}`);
      console.error(`           To change: set PROXY_PORT=4142 in .env`);
      process.exit(1);
    }
  }

  const server = createProxyServer();

  const cleanup = () => {
    console.log('[aido-proxy] Shutting down...');
    deletePid();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  server.listen(PORT, () => {
    writePid(PORT);
    console.log(`[aido-proxy] Listening on http://localhost:${PORT}`);
    console.log(`[aido-proxy] Routing based on model name in request body:`);
    console.log(`             /v1/chat/completions + model: "aido/auto"       → auto`);
    console.log(`             /v1/chat/completions + model: "aido/cloud"      → cloud (zen → groq → openai → anthropic)`);
    console.log(`             /v1/chat/completions + model: "aido/local"     → local ollama`);
    console.log(`             /v1/chat/completions + model: "aido/zen/..."   → Zen`);
    console.log(`             /v1/... (no model in body)             → ${DEFAULT_PROVIDER} (default)`);
  });
}
