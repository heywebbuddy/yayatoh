import { resolveTxt } from 'node:dns/promises';
import { safeFetch } from '@yayatoh/platform/ssrf';
import { fakeIdentityProvider, fakeMetadataFetcher, fakeTxtResolver } from './fake.ts';
import type { IdentityProviderPort, MetadataFetcher, TxtResolver } from './ports.ts';

/**
 * The SSO runtime of a deployment (M6.5a), set by each composition root (web, tests) before
 * commands run. `SSO_PROVIDER=fake` (the default outside production) uses the fake IdP, fake DNS
 * and fake metadata; `real` (always in production) uses DNS and SSRF-guarded HTTPS, and has no IdP
 * adapter until the owner's IdP test tenant is set up (owner inbox): single sign-on then reads as
 * unavailable and nothing signs in.
 */
export interface SsoRuntime {
  readonly idp: IdentityProviderPort | null;
  readonly resolveTxt: TxtResolver;
  readonly fetchMetadata: MetadataFetcher;
}

let runtime: SsoRuntime | null = null;

export function configureSso(r: SsoRuntime): void {
  runtime = r;
}

const realFetchMetadata: MetadataFetcher = async (url) => {
  const res = await safeFetch(url, { timeoutMs: 8000, maxBytes: 200_000 });
  if (res.status !== 200) throw new Error('metadata_unreachable');
  return new TextDecoder().decode(res.body);
};

export function ssoRuntime(): SsoRuntime {
  return runtime ?? { idp: null, resolveTxt, fetchMetadata: realFetchMetadata };
}

/** Whether this deployment uses the fakes. */
export function ssoMode(env: Record<string, string | undefined>): 'fake' | 'real' {
  if (env.VERCEL_ENV === 'production') return 'real';
  return env.SSO_PROVIDER === 'real' ? 'real' : 'fake';
}

/**
 * The runtime from the environment. `seed` signs fake IdP answers (derived from a server secret);
 * `idpUrl` is the fake IdP page.
 */
export function ssoRuntimeFromEnv(
  env: Record<string, string | undefined>,
  opts: { seed: string | null; idpUrl: string },
): SsoRuntime {
  if (ssoMode(env) === 'fake' && opts.seed && opts.seed.length >= 32)
    return {
      idp: fakeIdentityProvider({ seed: opts.seed, idpUrl: opts.idpUrl }),
      resolveTxt: fakeTxtResolver,
      fetchMetadata: fakeMetadataFetcher,
    };
  return { idp: null, resolveTxt, fetchMetadata: realFetchMetadata };
}
