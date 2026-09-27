import { billingEntitlements } from '@yayatoh/billing';
import { createCommandPorts } from '@yayatoh/platform';
import { orgAuthorizer } from '@yayatoh/tenancy';

/** Composition root for the web transport (Server Actions / RSC). Same ports as /v1. */
export const ports = createCommandPorts({ entitlements: billingEntitlements, authorizer: orgAuthorizer });
