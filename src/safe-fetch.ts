/**
 * Safe fetch wrapper that disables timeout.
 * 
 * Node.js 24's built-in fetch has issues with Cloudflare endpoints
 * (like opencode.ai). When IPv6 fails, it should fall back to IPv4,
 * but the default timeout is too short. Disabling timeout allows the
 * fallback to complete.
 * 
 * This mirrors what OpenCode SDK does:
 * @see https://github.com/opencode-ai/sdk/blob/main/src/client.js
 */

export async function safeFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  // Create request with timeout disabled for Cloudflare IPv6 fallback
  const req = (input instanceof Request) ? input : new Request(input, init);
  (req as any).timeout = false;
  // Use globalThis.fetch to ensure vitest mocks work
  return globalThis.fetch(req);
}
