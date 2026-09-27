import 'server-only';
import { billingEntitlements } from '@yayatoh/billing';
import { createCommandPorts } from '@yayatoh/platform';
import { orgAuthorizer } from '@yayatoh/tenancy';

/**
 * Composition root for the staff console. Staff act as a platform (system) actor named
 * `staff:<userId>`, so `platform:*` commands pass and every audit row names the person.
 */
export const ports = createCommandPorts({ entitlements: billingEntitlements, authorizer: orgAuthorizer });
