import { isRateLimited, markRateLimited } from './db.js';
import { PROVIDER_CONFIGS, type Provider } from './detector.js';

export function loadKeysForProvider(provider: Provider): string[] {
  // ollama-local needs no key — return a single placeholder so the rotator works
  if (PROVIDER_CONFIGS[provider]?.noAuth) {
    return ['local'];
  }
  // OLLAMA-LOCAL → OLLAMA_LOCAL_KEYS (hyphen → underscore for env var name)
  const envVar = `${provider.toUpperCase().replace(/-/g, '_')}_KEYS`;
  const raw = process.env[envVar] ?? '';
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

export class KeyRotator {
  private keys: string[];
  private index = 0;

  constructor(
    readonly provider: Provider,
    keys?: string[], // injectable for testing
  ) {
    this.keys = keys ?? loadKeysForProvider(provider);
  }

  get count(): number {
    return this.keys.length;
  }

  /** Returns next non-rate-limited key, or null if all are limited */
  next(): string | null {
    if (this.keys.length === 0) return null;

    const start = this.index;
    do {
      const key = this.keys[this.index];
      this.index = (this.index + 1) % this.keys.length;
      if (!isRateLimited(key)) return key;
    } while (this.index !== start);

    return null; // all keys exhausted
  }

  /** Mark a key as rate limited with optional cooldown (default 1h) */
  markLimited(key: string, cooldownSeconds = 3600): void {
    markRateLimited(key, this.provider, cooldownSeconds);
  }

  /** All keys including limited ones */
  allKeys(): string[] {
    return [...this.keys];
  }

  /** Only available (non-limited) keys */
  availableKeys(): string[] {
    return this.keys.filter((k) => !isRateLimited(k));
  }
}

/** Singleton rotators per provider */
const rotators = new Map<Provider, KeyRotator>();

export function getRotator(provider: Provider): KeyRotator {
  if (!rotators.has(provider)) {
    rotators.set(provider, new KeyRotator(provider));
  }
  return rotators.get(provider)!;
}

/** Reset rotators — used in tests */
export function resetRotators(): void {
  rotators.clear();
}
