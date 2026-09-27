import { billingEntitlements } from '@yayatoh/billing';
import { createCommandPorts } from '@yayatoh/platform';
import { orgAuthorizer } from '@yayatoh/tenancy';

/** The same composition the apps use: billing entitlements + tenancy authorizer. */
export const ports = createCommandPorts({ entitlements: billingEntitlements, authorizer: orgAuthorizer });
