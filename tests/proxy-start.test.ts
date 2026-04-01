import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writePid } from '../src/daemon.js';
import fs from 'fs';
import path from 'path';

const mockIsPortInUse = vi.fn();

vi.mock('../src/port-check.js', () => ({
  isPortInUse: mockIsPortInUse,
}));

describe('startProxy - port conflict handling', () => {
  const PID_FILE = path.join(process.cwd(), '.aido.pid');

beforeEach(() => {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch (err) {
    // Ignore errors during cleanup
  }
  mockIsPortInUse.mockReset();
});

  afterEach(() => {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  });

  it('exits gracefully when port is in use and no PID file exists', async () => {
    mockIsPortInUse.mockResolvedValue(true);

    const { startProxy } = await import('../src/proxy.js');
    
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    
    await expect(startProxy()).rejects.toThrow('process.exit called');
    
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error: Port 4141 is in use by another process')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('exits gracefully when port is in use and PID is stale', async () => {
    fs.writeFileSync(PID_FILE, JSON.stringify({ pid: 999999, port: 4141 }));
    mockIsPortInUse.mockResolvedValue(true);

    const { startProxy } = await import('../src/proxy.js');
    
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    
    await expect(startProxy()).rejects.toThrow('process.exit called');
    
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Stale PID file found')
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error: Port 4141 is in use by another process')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('exits gracefully when port is in use and PID is valid', async () => {
    writePid(4141);
    mockIsPortInUse.mockResolvedValue(true);

    const { startProxy } = await import('../src/proxy.js');
    
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    
    await expect(startProxy()).rejects.toThrow('process.exit called');
    
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error: Port 4141 is already in use by PID')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
