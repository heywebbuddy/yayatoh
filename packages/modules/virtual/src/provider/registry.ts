import { DomainError } from '@yayatoh/kernel';
import { cloudflareStreamProvider } from './cloudflare.ts';
import { fakeVideoProvider } from './fake.ts';
import { muxVideoProvider } from './mux.ts';
import type { PlaybackClaims, VideoProvider } from './port.ts';

/**
 * Pick the providers from configuration (like the AI drafter and integrations).
 * `VIDEO_PROVIDER=fake` (the default in dev, CI and previews) registers both fakes, seeded from
 * `APP_TOKEN_SECRET`: the fake Mux (`fake`, the default) and the fake Cloudflare Stream
 * (`fake_cloudflare`, M6.10a). `VIDEO_PROVIDER=mux` with `MUX_SIGNING_KEY_ID` and
 * `MUX_SIGNING_PRIVATE_KEY` selects Mux; `VIDEO_PROVIDER=cloudflare` with
 * `CLOUDFLARE_STREAM_SIGNING_KEY_ID`, `CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY` and
 * `CLOUDFLARE_STREAM_CUSTOMER_CODE` selects Cloudflare Stream; with a real default, the other real
 * provider joins when its keys are set too. Anything else, including production without keys,
 * returns none: streaming is off and the console says so. The first one is the default.
 */
export function videoProvidersFromEnv(env: Readonly<Record<string, string | undefined>>): VideoProvider[] {
  const wanted = env.VIDEO_PROVIDER ?? (env.NODE_ENV === 'production' && !env.YAYATOH_DEV_AUTH ? '' : 'fake');
  if (wanted === 'fake') {
    if (env.VERCEL_ENV === 'production' || !env.APP_TOKEN_SECRET || env.APP_TOKEN_SECRET.length < 32)
      return [];
    return [
      fakeVideoProvider({ seed: env.APP_TOKEN_SECRET }),
      fakeVideoProvider({ seed: env.APP_TOKEN_SECRET, kind: 'cloudflare' }),
    ];
  }
  const mux =
    env.MUX_SIGNING_KEY_ID && env.MUX_SIGNING_PRIVATE_KEY
      ? muxVideoProvider({
          signingKeyId: env.MUX_SIGNING_KEY_ID,
          signingPrivateKey: env.MUX_SIGNING_PRIVATE_KEY,
        })
      : null;
  const cloudflare =
    env.CLOUDFLARE_STREAM_SIGNING_KEY_ID &&
    env.CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY &&
    env.CLOUDFLARE_STREAM_CUSTOMER_CODE
      ? cloudflareStreamProvider({
          signingKeyId: env.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
          signingPrivateKey: env.CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY,
          customerCode: env.CLOUDFLARE_STREAM_CUSTOMER_CODE,
        })
      : null;
  if (wanted === 'mux' && mux) return cloudflare ? [mux, cloudflare] : [mux];
  if (wanted === 'cloudflare' && cloudflare) return mux ? [cloudflare, mux] : [cloudflare];
  return [];
}

/** The default provider from configuration (M6.9a's single-provider entry point), or null. */
export function videoProviderFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): VideoProvider | null {
  return videoProvidersFromEnv(env)[0] ?? null;
}

let configured: readonly VideoProvider[] = [];

/**
 * Each composition root (web, api, worker, tests) registers its providers (none: streaming off).
 * `provider` is the default; `providers` adds the others a session may switch to (M6.10a).
 */
export function configureVirtual(deps: {
  provider?: VideoProvider | null;
  providers?: readonly VideoProvider[];
}): void {
  const all = [...(deps.provider ? [deps.provider] : []), ...(deps.providers ?? [])];
  configured = all.filter((p, i) => all.findIndex((q) => q.name === p.name) === i);
}

/** The default provider, or null when streaming is off. */
export const currentVideoProvider = (): VideoProvider | null => configured[0] ?? null;

/** Every registered provider, the default first (the per-session choice). */
export const videoProviders = (): readonly VideoProvider[] => configured;

/**
 * The provider by name (a stream's), or the default without a name. `invalid_state`: `video_off`
 * when none is registered, `provider_unavailable` when that one is not (configuration changed).
 */
export function videoProvider(name?: string): VideoProvider {
  if (configured.length === 0)
    throw new DomainError('invalid_state', 'Streaming is not available', { reason: 'video_off' });
  if (name === undefined) return configured[0] as VideoProvider;
  const p = configured.find((x) => x.name === name);
  if (!p)
    throw new DomainError('invalid_state', 'This streaming provider is not available', {
      reason: 'provider_unavailable',
    });
  return p;
}

/**
 * The claims of a playback token any registered provider signed (each checks its own key id and
 * signature), with the provider that signed it; null for anything else.
 */
export function verifyPlaybackAny(
  token: string,
  now: Date,
): { provider: VideoProvider; claims: PlaybackClaims } | null {
  for (const provider of configured) {
    const claims = provider.verifyPlayback(token, now);
    if (claims) return { provider, claims };
  }
  return null;
}
