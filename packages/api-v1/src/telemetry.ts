export interface ClientInfo {
  /** `ios`, `android`, `web`, `sdk-ts`, … or `other`. */
  readonly client: string;
  readonly appVersion: string;
}

const TOKEN = /^[a-z0-9][a-z0-9._-]{0,39}$/i;

/**
 * Which app and version made a request, for per-route telemetry (M1.15). Read from
 * `X-Yayatoh-Client: <client>/<version>`, else `X-App-Version` with a client guessed from the
 * user agent, else `Yayatoh/<version>` or `YayatohSDK/<version>` in the user agent.
 */
export function clientInfo(headers: { get(name: string): string | null | undefined }): ClientInfo {
  const explicit = headers.get('x-yayatoh-client')?.trim();
  if (explicit) {
    const [client, version] = explicit.split('/', 2);
    if (client && TOKEN.test(client))
      return {
        client: client.toLowerCase(),
        appVersion: version && TOKEN.test(version) ? version : 'unknown',
      };
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
  if (header && TOKEN.test(header)) return { client: guessed, appVersion: header };
  const m = /Yayatoh(?:SDK)?\/([0-9A-Za-z._-]{1,40})/.exec(ua);
  return { client: guessed, appVersion: m?.[1] ?? 'unknown' };
}
