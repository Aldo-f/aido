#!/usr/bin/env bun
import 'dotenv/config';
import { Command } from 'commander';
import { detectProvider, type Provider } from './detector.js';
import { addKeyToEnv } from './env.js';
import { run } from './run.js';
import { startProxy } from './proxy.js';
import { launch } from './launch.js';
import { getRateLimitedKeys, clearExpiredLimits, clearAllLimits } from './db.js';
import { showModels } from './models.js';
import { loadKeysForProvider } from './rotator.js';

const program = new Command();

program
  .name('aido')
  .description('Local API key rotation proxy for LLM providers')
  .version('0.2.0');

// ─── add ────────────────────────────────────────────────────────────────────
program
  .command('add <key>')
  .description('Add an API key (provider auto-detected from key format)')
  .option('-p, --provider <provider>', 'Override provider detection')
  .action((key: string, opts: { provider?: string }) => {
    const provider = (opts.provider as Provider | undefined) ?? detectProvider(key);

    if (!provider) {
      console.error(`[add] Could not detect provider for key: ${key.slice(0, 10)}...`);
      console.error('Use --provider <zen|openai|anthropic|groq|google> to specify.');
      process.exit(1);
    }

    const result = addKeyToEnv(provider, key);
    if (!result.added) {
      console.log(`[add] Key already exists for ${provider}.`);
    } else {
      console.log(`[add] ✓ Added key to ${provider} (${result.total} key${result.total > 1 ? 's' : ''} total)`);
    }
  });

// ─── run ────────────────────────────────────────────────────────────────────
program
  .command('run <prompt>')
  .description('Send a prompt to a model via the proxy')
  .option('-p, --provider <provider>', 'Provider to use (default: auto with fallback)', 'auto')
  .option('-m, --model <model>', 'Model to use (defaults to free tier)')
  .option('-s, --stream', 'Stream the response', false)
  .action(async (prompt: string, opts: { provider: string; model?: string; stream: boolean }) => {
    await run(prompt, {
      provider: opts.provider as Provider,
      model: opts.model,
      stream: opts.stream,
    });
  });

// ─── models ─────────────────────────────────────────────────────────────────
program
  .command('models [provider]')
  .description('List available models for a provider (fetched with your key)')
  .option('--sync', 'Force refresh, ignore cache', false)
  .action(async (providerArg: string | undefined, opts: { sync: boolean }) => {
    const providers: Provider[] = providerArg
      ? [providerArg as Provider]
      : ['zen', 'openai', 'google', 'groq', 'ollama', 'ollama-local'];

    for (const provider of providers) {
      const keys = loadKeysForProvider(provider);
      if (keys.length === 0) {
        console.log(`\n[${provider}] No keys configured — skipping.`);
        continue;
      }
      await showModels(provider, keys[0], opts.sync);
    }
  });

// ─── proxy ──────────────────────────────────────────────────────────────────
program
  .command('proxy')
  .description('Start the proxy server (default port 4141)')
  .action(() => {
    startProxy();
  });

// ─── launch ─────────────────────────────────────────────────────────────────
program
  .command('launch')
  .description('Configure Claude Code / OpenCode to use the proxy')
  .option('--port <port>', 'Proxy port', '4141')
  .option('--target <target>', 'Which tool to configure: all | claude | opencode', 'all')
  .action(async (opts: { port: string; target: string }) => {
    await launch({
      port: parseInt(opts.port, 10),
      target: opts.target as 'all' | 'claude' | 'opencode',
    });
  });

// ─── status ─────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show currently rate-limited keys and configured providers')
  .action(() => {
    clearExpiredLimits();

    // Show configured providers
    const providers: Provider[] = ['zen', 'openai', 'anthropic', 'groq', 'google', 'ollama', 'ollama-local'];
    console.log('Configured providers:\n');
    for (const p of providers) {
      const keys = loadKeysForProvider(p);
      if (keys.length > 0) {
        console.log(`  ${p.padEnd(12)} ${keys.length} key${keys.length > 1 ? 's' : ''}`);
      }
    }

    const limited = getRateLimitedKeys();
    if (limited.length === 0) {
      console.log('\nAll keys are available.');
      return;
    }

    console.log(`\nRate-limited keys (${limited.length}):\n`);
    for (const { key, provider, limited_until } of limited) {
      const until = new Date(limited_until).toLocaleTimeString();
      console.log(`  ${provider.padEnd(12)} ...${key.slice(-8)}  (until ${until})`);
    }
  });

// ─── clear ─────────────────────────────────────────────────────────────────
program
  .command('clear')
  .description('Clear all rate limits (force all keys available)')
  .action(() => {
    const cleared = clearAllLimits();
    console.log(`[clear] Cleared ${cleared} rate limit${cleared !== 1 ? 's' : ''}.`);
  });

program.parse();

