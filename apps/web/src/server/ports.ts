import { billingEntitlements } from '@yayatoh/billing';
import { eventRolesOf } from '@yayatoh/events';
import { createCommandPorts, localKeyVault, setKeyVault } from '@yayatoh/platform';
import { defaultResolver } from '@yayatoh/platform/ssrf';
import { createOrgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
import { configureWebhooks, fakeResolver, webhookPublisherFromEnv } from '@yayatoh/webhooks';

/** Composition root for the web transport (Server Actions / RSC). Same ports as /v1. */
export const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: createOrgAuthorizer({ eventRoles: eventRolesOf }),
  // A suspended or terminated org is read-only for its members and the public (M1.3f).
  orgGate: orgStatusGate,
});

// AWS KMS arrives with the owner's AWS account; until then dev/preview/CI use the local vault.
const localKms = process.env.LOCAL_KMS_KEY;
if (localKms) setKeyVault(localKeyVault(localKms));

// M6.3b: outbound webhooks through Svix, or the fake (dev, preview, CI) until the owner's account.
const webhookPublisher = webhookPublisherFromEnv(
  process.env,
  process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.BETTER_AUTH_URL || 'http://localhost:3000',
);
configureWebhooks({
  publisher: webhookPublisher,
  resolver: webhookPublisher?.name === 'fake' ? fakeResolver : defaultResolver,
});
