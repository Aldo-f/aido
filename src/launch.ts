import fs from 'fs';
import path from 'path';
import os from 'os';

const PROXY_BASE = 'http://localhost:4141';

async function fetchLocalOllamaModels(): Promise<Record<string, { name: string }>> {
  const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return fallbackLocalModels();
    const json = await res.json() as { models?: Array<{ name: string }> };
    const models = json.models ?? [];
    if (models.length === 0) return fallbackLocalModels();
    return Object.fromEntries(
      models.map(m => [m.name, { name: m.name + ' (local)' }])
    );
  } catch {
    return fallbackLocalModels();
  }
}

function fallbackLocalModels(): Record<string, { name: string }> {
  return {
    'qwen3:8b': { name: 'Qwen3 8B (local)' },
    'glm-4.7-flash': { name: 'GLM-4.7 Flash (local)' },
  };
}

// ─── Claude Code ───────────────────────────────────────────────────────────────
// Claude Code respects ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY env vars.
// We write a shell snippet the user can source, and optionally patch .bashrc/.zshrc

function launchClaudeCode(port: number): void {
  const base = `http://localhost:${port}/anthropic`;
  const snippet = [
    `export ANTHROPIC_BASE_URL="${base}"`,
    `export ANTHROPIC_API_KEY="aido-proxy"  # key injected by proxy`,
  ].join('\n');

  console.log('\n── Claude Code ───────────────────────────────────────────');
  console.log('Add to your shell profile (or run now):\n');
  console.log(snippet);

  // Try to write to shell profile
  const profile = getShellProfile();
  if (profile && patchShellProfile(profile, snippet)) {
    console.log(`\n✓ Patched ${profile}`);
    console.log('  Restart your terminal or run: source ' + profile);
  }
}

// ─── OpenCode ──────────────────────────────────────────────────────────────────
// OpenCode config: ~/.config/opencode/opencode.json
// Schema: https://opencode.ai/config.json
// Custom provider needs: npm, name, options.baseURL, options.apiKey, models

interface OpenCodeProviderConfig {
  npm: string;
  name: string;
  options: { baseURL: string; apiKey: string };
  models: Record<string, { name: string }>;
}

interface OpenCodeConfig {
  $schema?: string;
  model?: string;
  provider?: Record<string, OpenCodeProviderConfig>;
  [key: string]: unknown;
}

// Free models on OpenCode Zen (from /zen/v1/models)
const ZEN_FREE_MODELS: Record<string, string> = {
  'big-pickle':          'Big Pickle (Free)',
  'mimo-v2-flash-free':  'MiMo V2 Flash (Free)',
  'nemotron-3-super-free': 'Nemotron 3 Super (Free)',
  'minimax-m2.5-free':   'MiniMax M2.5 (Free)',
};

async function launchOpenCode(port: number): Promise<void> {
  const configDir = path.join(os.homedir(), '.config', 'opencode');
  const configPath = path.join(configDir, 'opencode.json');

  let config: OpenCodeConfig = { $schema: 'https://opencode.ai/config.json' };
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      console.warn(`[launch] Could not parse ${configPath}, creating fresh config`);
    }
  }

  config.$schema ??= 'https://opencode.ai/config.json';
  config.model = 'aido/auto';
  config.provider ??= {};

  for (const key of Object.keys(config.provider)) {
    if (key.startsWith('aido')) {
      delete config.provider[key];
    }
  }

  // Fetch local Ollama models dynamically
  const localModels = await fetchLocalOllamaModels();

  // Build all models with full aido/ prefix
  const allModels: Record<string, { name: string }> = {};

  // Meta models first
  allModels['aido/auto'] = { name: '⚡ Auto (best available)' };
  allModels['aido/cloud'] = { name: '☁️ Cloud Auto' };
  allModels['aido/local'] = { name: '🏠 Local Ollama Auto' };

  // Zen free models
  allModels['aido/zen/big-pickle'] = { name: 'Big Pickle (Free)' };
  allModels['aido/zen/mimo-v2-flash-free'] = { name: 'MiMo V2 Flash (Free)' };
  allModels['aido/zen/nemotron-3-super-free'] = { name: 'Nemotron 3 Super (Free)' };
  allModels['aido/zen/minimax-m2.5-free'] = { name: 'MiniMax M2.5 (Free)' };

  // Ollama Cloud models
  allModels['aido/ollama/glm-5:cloud'] = { name: 'GLM-5 Cloud' };
  allModels['aido/ollama/kimi-k2.5:cloud'] = { name: 'Kimi K2.5 Cloud' };
  allModels['aido/ollama/minimax-m2.5:cloud'] = { name: 'MiniMax M2.5 Cloud' };

  // Local Ollama models
  for (const [model, info] of Object.entries(localModels)) {
    allModels[`aido/local/${model}`] = { name: info.name };
  }

  // Single provider with all models
  config.provider['aido'] = {
    npm: '@ai-sdk/openai-compatible',
    name: 'AIdo (all providers)',
    options: {
      baseURL: `http://localhost:${port}/v1`,
      apiKey: 'aido-proxy',
    },
    models: allModels,
  };

  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log('\n── OpenCode ──────────────────────────────────────────────');
  console.log(`✓ Wrote ${configPath}`);
  console.log(`  Single provider: aido (routes based on model name in request)`);
  console.log(`  Default model: aido/auto`);
  console.log(`  Models: aido/auto, aido/cloud, aido/local, aido/zen/*, aido/ollama/*`);
  console.log(`\n  Restart OpenCode to apply changes.`);
}

// ─── Shell profile helpers ─────────────────────────────────────────────────────

function getShellProfile(): string | null {
  const shell = process.env.SHELL ?? '';
  const home = os.homedir();
  if (shell.includes('zsh')) return path.join(home, '.zshrc');
  if (shell.includes('bash')) return path.join(home, '.bashrc');
  return null;
}

const MARKER = '# aido-proxy config';

function patchShellProfile(profile: string, snippet: string): boolean {
  try {
    let content = fs.existsSync(profile) ? fs.readFileSync(profile, 'utf8') : '';

    // Remove previous block if present
    const markerStart = content.indexOf(MARKER);
    if (markerStart !== -1) {
      const markerEnd = content.indexOf(MARKER, markerStart + 1);
      content = content.slice(0, markerStart) + content.slice(markerEnd + MARKER.length + 1);
    }

    content += `\n${MARKER}\n${snippet}\n${MARKER}\n`;
    fs.writeFileSync(profile, content);
    return true;
  } catch {
    return false;
  }
}

// ─── Entry ─────────────────────────────────────────────────────────────────────

export interface LaunchOptions {
  port: number;
  target: 'all' | 'claude' | 'opencode';
}

export async function launch(opts: LaunchOptions): Promise<void> {
  const { port, target } = opts;

  console.log(`[launch] Configuring tools to use proxy at http://localhost:${port}`);

  if (target === 'all' || target === 'claude') {
    launchClaudeCode(port);
  }
  if (target === 'all' || target === 'opencode') {
    await launchOpenCode(port);
  }
  console.log('\n✓ Done. Start the proxy with: aido-proxy proxy');
}
