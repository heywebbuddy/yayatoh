/**
 * `connect-src` origins the realtime transport needs (M3.1b). SSE is same-origin (`'self'`);
 * with `REALTIME_PROVIDER=ably` the browser also talks to Ably (an `https:` source also allows
 * the matching `wss:` WebSocket in CSP3). Pure, for proxy.ts.
 */
export const ABLY_CONNECT_SOURCES = [
  'https://*.ably.io',
  'https://*.ably-realtime.com',
  'https://*.ably.net',
] as const;

export function realtimeConnectSources(env: Record<string, string | undefined> = process.env): string[] {
  return env.REALTIME_PROVIDER === 'ably' && env.ABLY_API_KEY ? [...ABLY_CONNECT_SOURCES] : [];
}
