import fs from 'fs';
import path from 'path';

const PID_FILE = path.join(process.cwd(), '.aido.pid');

interface PidData {
  pid: number;
  port: number;
}

export function writePid(port: number): void {
  const data: PidData = {
    pid: process.pid,
    port,
  };
  fs.writeFileSync(PID_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export function readPid(): PidData | null {
  if (!fs.existsSync(PID_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(PID_FILE, 'utf8');
    const data = JSON.parse(content) as PidData;
    if (typeof data.pid !== 'number' || typeof data.port !== 'number') {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function deletePid(): void {
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
}

export function isStale(): boolean {
  const data = readPid();
  if (!data) {
    return false;
  }

  try {
    process.kill(data.pid, 0);
    return false;
  } catch {
    return true;
  }
}
