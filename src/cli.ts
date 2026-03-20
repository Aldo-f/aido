#!/usr/bin/env bun
import 'dotenv/config';
import { Command } from 'commander';
import { detectProvider, type Provider } from './detector.js';
import { addKeyToEnv } from './env.js';
import { run } from './run.js';
import { startProxy } from './proxy.js';
import { launch } from './launch.js';
import { getRateLimitedKeys, clearExpiredLimits, clearAllLimits, clearAllModelLimits } from './db.js';
import { showModels } from './models.js';
import { loadKeysForProvider } from './rotator.js';
import { readPid, deletePid, isStale } from './daemon.js';
import { huntKeys, validateKey, startHuntDaemon, isHuntRunning, readHuntPid, deleteHuntPid } from './hunt.js';
import { forwardAutoFree } from './auto.js';

// Gracefully handle broken pipes (e.g., piping to head, grep, etc.)
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Exit gracefully when consumer closes the pipe
    process.exit(0);
  }
  // Re-throw other errors
  throw err;
});

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
  .option('--only-free', 'Only use free models (skip paid models)')
  .option('--only-paid', 'Only use paid models (skip free models)')
  .action(async (prompt: string, opts: { provider: string; model?: string; stream: boolean; onlyFree: boolean; onlyPaid: boolean }) => {
    let strategy: 'free' | 'paid' | 'both' = 'both';
    if (opts.onlyFree) strategy = 'free';
    if (opts.onlyPaid) strategy = 'paid';
    
    await run(prompt, {
      provider: opts.provider as Provider,
      model: opts.model,
      stream: opts.stream,
      strategy,
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
       : ['zen', 'openai', 'google', 'groq', 'ollama', 'ollama-local', 'openrouter'];

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
  .action(async () => {
    await startProxy();
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
    const providers: Provider[] = ['zen', 'openai', 'anthropic', 'groq', 'google', 'ollama', 'ollama-local', 'openrouter'];
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
    const modelCleared = clearAllModelLimits();
    console.log(`[clear] Cleared ${cleared} key limit${cleared !== 1 ? 's' : ''} and ${modelCleared} model limit${modelCleared !== 1 ? 's' : ''}.`);
  });

// ─── sync ─────────────────────────────────────────────────────────────────
program
  .command('sync')
  .description('Clear rate limits and refresh models from all providers')
  .action(async () => {
    const clearedKeys = clearAllLimits();
    const clearedModels = clearAllModelLimits();
    console.log(`[sync] Cleared ${clearedKeys} key limit${clearedKeys !== 1 ? 's' : ''} and ${clearedModels} model limit${clearedModels !== 1 ? 's' : ''}.`);

    const providers: Provider[] = ['zen', 'openai', 'google', 'groq', 'ollama', 'ollama-local', 'openrouter'];
    console.log('[sync] Refreshing models from all providers...\n');

    for (const provider of providers) {
      const keys = loadKeysForProvider(provider);
      if (keys.length === 0) {
        console.log(`[${provider}] No keys configured — skipping.`);
        continue;
      }
      
      let success = false;
      for (const key of keys) {
        try {
          await showModels(provider, key, true);
          success = true;
          break;
        } catch {}
      }
      
      if (!success) {
        console.log(`[${provider}] All keys failed — skipping.`);
      }
    }

    console.log('\n[sync] ✓ Sync complete');
  });

// ─── stop ─────────────────────────────────────────────────────────────────
program
  .command('stop')
  .description('Stop the running proxy server')
  .action(() => {
    const pidData = readPid();
    if (!pidData) {
      console.log('[stop] No proxy running (no PID file found)');
      return;
    }
    if (isStale()) {
      console.log('[stop] Stale PID file found, removing...');
      deletePid();
      return;
    }
    try {
      process.kill(pidData.pid, 'SIGTERM');
      console.log(`[stop] Sent SIGTERM to proxy (PID: ${pidData.pid})`);
      deletePid();
    } catch (err) {
      console.error('[stop] Failed to stop proxy:', (err as Error).message);
    }
  });

// ─── hunt ─────────────────────────────────────────────────────────────────
program
  .command('hunt')
  .description('Search for free API keys (requires manual entry for security)')
  .option('-l, --limit <number>', 'Stop after N keys found', '3')
  .option('-t, --timeout <seconds>', 'Max search time in seconds', '60')
  .option('-p, --provider <provider>', 'Search only specific provider')
  .option('-d, --daemon', 'Run continuously in background', true)
  .option('-i, --interval <seconds>', 'Interval between rounds in daemon mode', '60')
  .action(async (opts: { limit: string; timeout: string; provider?: string; daemon: boolean; interval: string }) => {
    if (opts.daemon) {
      await startHuntDaemon({
        limit: parseInt(opts.limit, 10),
        timeout: parseInt(opts.timeout, 10),
        provider: opts.provider,
        continuous: true,
        interval: parseInt(opts.interval, 10),
      });
    } else {
      await huntKeys({
        limit: parseInt(opts.limit, 10),
        timeout: parseInt(opts.timeout, 10),
        provider: opts.provider,
      });
    }
  });

// ─── hunt:stop ───────────────────────────────────────────────────────────────
program
  .command('hunt:stop')
  .description('Stop the running hunt daemon')
  .action(() => {
    const pid = readHuntPid();
    if (!pid) {
      console.log('[hunt] No daemon running (no PID file found)');
      return;
    }
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[hunt] Stopped daemon (PID: ${pid})`);
      deleteHuntPid();
    } catch (err) {
      console.log('[hunt] Daemon not running, cleaning up stale PID...');
      deleteHuntPid();
    }
  });

// ─── key validate ────────────────────────────────────────────────────────
program
  .command('key:validate')
  .description('Validate an API key')
  .argument('<key>', 'API key to validate')
  .option('-p, --provider <provider>', 'Specific provider to test')
  .action(async (key: string, opts: { provider?: string }) => {
    const valid = await validateKey(key, opts.provider);
    if (valid) {
      console.log('✓ Key is valid');
    } else {
      console.log('✗ Key is invalid');
    }
  });

program
  .command('analytics')
  .description('Start the analytics dashboard server')
  .option('-p, --port <port>', 'Port to run on', '4142')
  .action(async (opts: { port?: string }) => {
    const { startAnalyticsServer } = await import('./analytics/api.js');
    const port = opts.port ? parseInt(opts.port, 10) : 4142;
    const server = startAnalyticsServer(port);
    console.log(`[analytics] Dashboard available at http://localhost:${port}`);
    console.log(`[analytics] Press Ctrl+C to stop`);
    process.on('SIGINT', () => {
      server.close();
      process.exit(0);
    });
    await new Promise(() => {});
  });

program.parse();

