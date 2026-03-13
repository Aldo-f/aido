import fs from 'fs';
import path from 'path';

const LOG_DIR = 'logs';

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogFilename(): string {
  const today = new Date().toISOString().split('T')[0];
  return `${today}.log`;
}

export interface LogEntry {
  timestamp: string;
  provider: string;
  model: string;
  key: string;
  status: number;
  duration: number;
  responseSize: number;
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return key;
  if (key === 'local') return 'local';
  return `****${key.slice(-8)}`;
}

export function logRequest(params: {
  provider: string;
  model: string;
  key: string;
  status: number;
  duration: number;
  responseSize?: number;
}): void {
  ensureLogDir();
  
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    provider: params.provider,
    model: params.model,
    key: maskKey(params.key),
    status: params.status,
    duration: params.duration,
    responseSize: params.responseSize ?? 0,
  };

  const line = [
    entry.timestamp,
    '|',
    entry.provider,
    '|',
    entry.model,
    '|',
    entry.key,
    '|',
    entry.status,
    '|',
    `${entry.duration}ms`,
    '|',
    `${entry.responseSize}b`,
  ].join(' ');

  const logFile = path.join(LOG_DIR, getLogFilename());
  fs.appendFileSync(logFile, line + '\n');
}
