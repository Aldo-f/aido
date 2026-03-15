import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import 'dotenv/config';
import { markSourceSearched, isSourceSearchedRecently } from '../db.js';

const GITLEAKS_BIN = path.join(process.cwd(), 'bin', 'gitleaks');

interface GitleaksResult {
  RuleID: string;
  Match: string;
  Secret: string;
  File: string;
  StartLine: number;
  EndLine: number;
  Commit: string;
  Author: string;
  Email: string;
  Date: string;
  Message: string;
}

export interface FoundSecret {
  secret: string;
  rule: string;
  file: string;
  repo: string;
}

function getGitleaksBin(): string {
  if (fs.existsSync(GITLEAKS_BIN)) {
    return GITLEAKS_BIN;
  }
  return 'gitleaks';
}

function getAuthRepoUrl(repoUrl: string): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log('[gitleaks] WARNING: GITHUB_TOKEN not set, cloning may fail');
    return repoUrl;
  }
  return repoUrl.replace('https://github.com/', `https://${token}@github.com/`);
}

export async function scanRepoWithGitleaks(repoUrl: string): Promise<FoundSecret[]> {
  const isSkipped = isSourceSearchedRecently(repoUrl, 24);
  if (isSkipped) {
    console.log(`[gitleaks] Skipping already scanned repo: ${repoUrl}`);
    return [];
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitleaks-'));
  
  try {
    const authUrl = getAuthRepoUrl(repoUrl);
    console.log(`[gitleaks] Cloning ${repoUrl}...`);
    
    await runCommand('git', ['clone', '--depth', '1', '--bare', authUrl, tempDir], {
      timeout: 60000,
    });

    console.log(`[gitleaks] Scanning...`);
    
    const output = await runCommand(getGitleaksBin(), [
      'detect',
      '--source', tempDir,
      '--report-format', 'json',
      '--no-git',
    ], {
      timeout: 120000,
    });

    if (!output.trim()) {
      markSourceSearched(repoUrl, 'gitleaks', 0);
      return [];
    }

    const results = JSON.parse(output) as GitleaksResult[];
    console.log(`[gitleaks] Found ${results.length} potential secrets`);

    const found: FoundSecret[] = [];
    
    for (const result of results) {
      if (result.Secret) {
        found.push({
          secret: result.Secret,
          rule: result.RuleID,
          file: result.File,
          repo: repoUrl,
        });
      }
    }

    markSourceSearched(repoUrl, 'gitleaks', found.length);
    return found;
  } catch (e) {
    console.log(`[gitleaks] Error scanning ${repoUrl}: ${(e as Error).message}`);
    markSourceSearched(repoUrl, 'gitleaks', 0);
    return [];
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function runCommand(cmd: string, args: string[], opts: { timeout: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      timeout: opts.timeout,
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0 || code === 1) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `exit code ${code}`));
      }
    });
    
    proc.on('error', reject);
    
    setTimeout(() => {
      proc.kill();
      reject(new Error('timeout'));
    }, opts.timeout);
  });
}

export async function scanRepos(repos: string[]): Promise<FoundSecret[]> {
  const allFound: FoundSecret[] = [];
  
  for (const repo of repos) {
    if (allFound.length >= 10) break;
    
    const found = await scanRepoWithGitleaks(repo);
    allFound.push(...found);
  }
  
  return allFound;
}
