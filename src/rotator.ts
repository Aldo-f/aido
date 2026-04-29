import {
  isModelRateLimited,
  isRateLimited,
  markModelRateLimited,
  markRateLimited,
} from './db.js';
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
  private models: string[];
  private keyIndex = 0;
  private modelIndex = 0;

  constructor(
    readonly provider: Provider,
    keys?: string[],
    models?: string[],
  ) {
    this.keys = keys ?? loadKeysForProvider(provider);
    this.models = models ?? [];
  }

  get count(): number {
    return this.keys.length;
  }

  next(): string | null {
    if (this.keys.length === 0) return null;

    const start = this.keyIndex;
    do {
      const key = this.keys[this.keyIndex];
      this.keyIndex = (this.keyIndex + 1) % this.keys.length;
      if (!isRateLimited(key)) return key;
    } while (this.keyIndex !== start);

    return null;
  }

  markLimited(key: string, cooldownSeconds = 3600): void {
    markRateLimited(key, this.provider, cooldownSeconds);
  }

  markInvalidKey(key: string): void {
    const THIRTY_DAYS = 30 * 24 * 60 * 60;
    markRateLimited(key, this.provider, THIRTY_DAYS);
  }

  markQuotaExceeded(key: string): void {
    const NINETY_DAYS = 90 * 24 * 60 * 60;
    markRateLimited(key, this.provider, NINETY_DAYS);
  }

  allKeys(): string[] {
    return [...this.keys];
  }

  availableKeys(): string[] {
    return this.keys.filter((k) => !isRateLimited(k));
  }

  hasModels(): boolean {
    return this.models.length > 0;
  }

  getNextModel(): { key: string; model: string } | null {
    if (this.models.length === 0) {
      const key = this.next();
      if (!key) return null;
      return { key, model: '' };
    }

    if (this.keys.length === 0) return null;

    const startModel = this.modelIndex;
    const startKey = this.keyIndex;

    do {
      const model = this.models[this.modelIndex];
      const key = this.keys[this.keyIndex];

      const modelLimited = isModelRateLimited(this.provider, model);
      const keyLimited = isRateLimited(key);

      if (!modelLimited && !keyLimited) {
        const result = { key, model };
        this.keyIndex = (this.keyIndex + 1) % this.keys.length;
        this.modelIndex = (this.modelIndex + 1) % this.models.length;
        return result;
      }

      if (modelLimited && !keyLimited) {
        this.modelIndex = (this.modelIndex + 1) % this.models.length;
      } else if (!modelLimited && keyLimited) {
        this.keyIndex = (this.keyIndex + 1) % this.keys.length;
      } else {
        this.keyIndex = (this.keyIndex + 1) % this.keys.length;
        this.modelIndex = (this.modelIndex + 1) % this.models.length;
      }
    } while (this.modelIndex !== startModel || this.keyIndex !== startKey);

    return null;
  }

  markModelLimited(model: string, cooldownSeconds = 3600): void {
    markModelRateLimited(this.provider, model, cooldownSeconds);
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
