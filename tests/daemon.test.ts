import { describe, it, expect, beforeEach } from 'vitest';
import { writePid, readPid, deletePid, isStale } from '../src/daemon';
import fs from 'fs';
import path from 'path';

describe('daemon', () => {
  const PID_FILE = path.join(process.cwd(), '.aido.pid');

  beforeEach(() => {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  });

  it('writes and reads PID', () => {
    writePid(4141);
    const data = readPid();
    expect(data).toEqual({ pid: process.pid, port: 4141 });
    deletePid();
  });

  it('returns null when no PID file', () => {
    const data = readPid();
    expect(data).toBeNull();
  });

  it('detects stale PID', () => {
    fs.writeFileSync(PID_FILE, JSON.stringify({ pid: 99999, port: 4141 }));
    const stale = isStale();
    expect(stale).toBe(true);
    deletePid();
  });
});
