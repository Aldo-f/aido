#!/usr/bin/env bun
import 'dotenv/config';
import { PROVIDER_CONFIGS, type Provider } from '../src/detector.js';
import { loadKeysForProvider } from '../src/rotator.js';
import { PRIORITIES } from '../src/priorities.js';

const TEST_PROMPT = 'Say "OK" in exactly one word.';

interface TestResult {
  provider: Provider;
  model: string;
  success: boolean;
  status?: number;
  error?: string;
  duration: number;
}

async function testProvider(provider: Provider, model: string): Promise<TestResult> {
  const start = Date.now();
  const keys = loadKeysForProvider(provider);
  
  if (keys.length === 0) {
    return { provider, model, success: false, error: 'no keys', duration: Date.now() - start };
  }

  const key = keys[0];
  const config = PROVIDER_CONFIGS[provider];
  const isOllama = config.nativeFormat === true;

  let url: string;
  if (isOllama) {
    url = `${config.baseUrl}/chat`;
  } else {
    url = `${config.baseUrl}/chat/completions`;
  }

  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: TEST_PROMPT }],
    stream: false,
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...config.authHeader(key),
      },
      body,
    });

    const duration = Date.now() - start;
    
    if (res.ok) {
      return { provider, model, success: true, status: res.status, duration };
    } else {
      const errorText = await res.text();
      return { provider, model, success: false, status: res.status, error: errorText.slice(0, 100), duration };
    }
  } catch (err) {
    return { provider, model, success: false, error: (err as Error).message, duration: Date.now() - start };
  }
}

async function main() {
  console.log('Testing free providers...\n');

  const results: TestResult[] = [];

  for (const { provider, model } of PRIORITIES.auto) {
    process.stdout.write(`Testing ${provider}/${model}... `);
    const result = await testProvider(provider, model);
    results.push(result);

    if (result.success) {
      console.log(`✓ OK (${result.duration}ms)`);
    } else {
      console.log(`✗ ${result.status || 'error'}: ${result.error || 'unknown'}`);
    }
  }

  console.log('\n--- Summary ---');
  const passed = results.filter(r => r.success).length;
  console.log(`${passed}/${results.length} providers working`);
}

main();
