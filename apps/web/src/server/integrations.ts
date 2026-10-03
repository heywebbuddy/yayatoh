import 'server-only';
import { type IntegrationAuth, integrationAuthFromEnv } from '@yayatoh/integrations';

let auth: IntegrationAuth | null | undefined;

/**
 * The `IntegrationAuth` port for this deployment (M6.4a): the fake in dev, CI and previews; Nango
 * once the owner's account is configured; null (integrations off) otherwise.
 */
export function integrationAuth(): IntegrationAuth | null {
  if (auth === undefined) auth = integrationAuthFromEnv(process.env);
  return auth;
}
