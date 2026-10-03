import { DomainError } from '@yayatoh/kernel';
import { fakeVideoProvider } from './fake.ts';
import { muxVideoProvider } from './mux.ts';
import type { VideoProvider } from './port.ts';

/**
 * Pick the provider from configuration (like the AI drafter and integrations): `VIDEO_PROVIDER=mux`
 * with `MUX_SIGNING_KEY_ID` and `MUX_SIGNING_PRIVATE_KEY` selects Mux; `fake` (the default in dev,
 * CI and previews) the fake, seeded from `APP_TOKEN_SECRET`. Anything else, including production
 * without Mux, returns null: streaming is off and the console says so.
 */
export function videoProviderFromEnv(env: Readonly<Record<string, string | undefined>>): VideoProvider | null {
  const provider = env.VIDEO_PROVIDER ?? (env.NODE_ENV === 'production' && !env.YAYATOH_DEV_AUTH ? '' : 'fake');
  if (provider === 'fake') {
    if (env.VERCEL_ENV === 'production' || !env.APP_TOKEN_SECRET || env.APP_TOKEN_SECRET.length < 32)
      return null;
    return fakeVideoProvider({ seed: env.APP_TOKEN_SECRET });
  }
  if (provider === 'mux' && env.MUX_SIGNING_KEY_ID && env.MUX_SIGNING_PRIVATE_KEY)
    return muxVideoProvider({
      signingKeyId: env.MUX_SIGNING_KEY_ID,
      signingPrivateKey: env.MUX_SIGNING_PRIVATE_KEY,
    });
  return null;
}

let configured: VideoProvider | null = null;

/** Each composition root (web, api, worker, tests) registers the provider (or null: off). */
export function configureVirtual(deps: { provider: VideoProvider | null }): void {
  configured = deps.provider;
}

/** The registered provider, or null when streaming is off. */
export const currentVideoProvider = (): VideoProvider | null => configured;

/** The registered provider; `invalid_state` (`video_off`) when there is none. */
export function videoProvider(): VideoProvider {
  if (!configured)
    throw new DomainError('invalid_state', 'Streaming is not available', { reason: 'video_off' });
  return configured;
}
