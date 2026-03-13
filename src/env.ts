import fs from 'fs';
import path from 'path';

const ENV_PATH = process.env.ENV_FILE ?? path.join(process.cwd(), '.env');

/** Read .env as a key→value map (unparsed values, raw strings) */
export function readEnvFile(filePath = ENV_PATH): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(filePath)) return map;

  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return map;
}

/** Write map back to .env, preserving order and comments */
export function writeEnvFile(map: Map<string, string>, filePath = ENV_PATH): void {
  const lines: string[] = [];

  // Read existing file to preserve comments and ordering
  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8').split('\n')
    : [];

  const written = new Set<string>();

  for (const line of existing) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      lines.push(line);
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) { lines.push(line); continue; }
    const key = trimmed.slice(0, eq).trim();

    if (map.has(key)) {
      lines.push(`${key}=${map.get(key)}`);
      written.add(key);
    }
    // key removed from map → skip line
  }

  // Append new keys
  for (const [key, value] of map) {
    if (!written.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

/** Add an API key to the .env file under PROVIDER_KEYS */
export function addKeyToEnv(provider: string, key: string, filePath = ENV_PATH): {
  added: boolean;
  total: number;
} {
  const envVar = `${provider.toUpperCase()}_KEYS`;
  const map = readEnvFile(filePath);
  const existing = map.get(envVar) ?? '';
  const keys = existing.split(',').map((k) => k.trim()).filter(Boolean);

  if (keys.includes(key)) {
    return { added: false, total: keys.length };
  }

  keys.push(key);
  map.set(envVar, keys.join(','));
  writeEnvFile(map, filePath);

  return { added: true, total: keys.length };
}
