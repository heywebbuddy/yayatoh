export interface ClientInfo {
  /** `ios`, `android`, `web`, `sdk-ts`, … or `other`. */
  readonly client: string;
  readonly appVersion: string;
}

/** Known clients; anything else counts as `other`, so callers cannot mint new counter rows. */
export const KNOWN_CLIENTS = [
  'ios',
  'android',
  'web',
  'scan-pwa',
  'sdk-ts',
  'sdk-swift',
  'sdk-kotlin',
] as const;
/** `1`, `3.2`, `3.2.1`, `3.2.1.4`, optionally with a short pre-release or build suffix. */
const VERSION = /^\d{1,6}(\.\d{1,6}){0,3}([-+][0-9A-Za-z.]{1,20})?$/;
const known = (c: string) => ((KNOWN_CLIENTS as readonly string[]).includes(c) ? c : 'other');
const version = (v: string | undefined) => (v && VERSION.test(v) ? v : 'unknown');

/**
 * Which app and version made a request, for per-route telemetry (M1.15). Read from
 * `X-Yayatoh-Client: <client>/<version>`, else `X-App-Version` with a client guessed from the
 * user agent, else `Yayatoh/<version>` or `YayatohSDK/<version>` in the user agent.
 */
export function clientInfo(headers: { get(name: string): string | null | undefined }): ClientInfo {
  const explicit = headers.get('x-yayatoh-client')?.trim();
  if (explicit) {
    const [client, v] = explicit.split('/', 2);
    if (client) return { client: known(client.toLowerCase()), appVersion: version(v) };
  }
  const ua = headers.get('user-agent') ?? '';
  const guessed = /iphone|ipad|ios|cfnetwork|darwin/i.test(ua)
    ? 'ios'
    : /android|okhttp|dalvik/i.test(ua)
      ? 'android'
      : /yayatohsdk/i.test(ua)
        ? 'sdk-ts'
        : 'other';
  const header = headers.get('x-app-version')?.trim();
  if (header && VERSION.test(header)) return { client: guessed, appVersion: header };
  const m = /Yayatoh(?:SDK)?\/([0-9A-Za-z.+-]{1,40})/.exec(ua);
  return { client: guessed, appVersion: version(m?.[1]) };
}
