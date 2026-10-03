import { CONNECTORS } from '../connectors/index.ts';
import { fakeIntegrationAuth } from './fake.ts';
import { nangoIntegrationAuth } from './nango.ts';
import type { IntegrationAuth } from './port.ts';

/** The fake port with every connector's fake provider API. */
export function fakeAuthForConnectors(): IntegrationAuth {
  return fakeIntegrationAuth((key) => CONNECTORS.find((c) => c.providerConfigKey === key)?.fake ?? null);
}

/**
 * Pick the port from configuration (like the AI drafter): `INTEGRATIONS_AUTH_PROVIDER=nango` with
 * `NANGO_SECRET_KEY` (and optionally `NANGO_HOST`) selects Nango; `fake` (the default in dev, CI
 * and previews) the fake. Anything else, including production without Nango, returns null:
 * integrations are off and the console says so.
 */
export function integrationAuthFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): IntegrationAuth | null {
  const provider =
    env.INTEGRATIONS_AUTH_PROVIDER ?? (env.NODE_ENV === 'production' && !env.YAYATOH_DEV_AUTH ? '' : 'fake');
  if (provider === 'fake') {
    if (env.VERCEL_ENV === 'production') return null;
    return fakeAuthForConnectors();
  }
  if (provider === 'nango' && env.NANGO_SECRET_KEY)
    return nangoIntegrationAuth({
      secretKey: env.NANGO_SECRET_KEY,
      ...(env.NANGO_HOST ? { baseUrl: env.NANGO_HOST } : {}),
    });
  return null;
}
