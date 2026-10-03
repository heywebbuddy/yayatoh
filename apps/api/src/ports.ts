import { billingEntitlements, billingReadOnlyGate, composeOrgGates } from '@yayatoh/billing';
import { eventRolesOf } from '@yayatoh/events';
import { createCommandPorts } from '@yayatoh/platform';
import { createOrgAuthorizer, memberRoleTx, orgStatusGate } from '@yayatoh/tenancy';

/** The same composition as the web app: billing entitlements + tenancy authorizer. */
export const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: createOrgAuthorizer({ eventRoles: eventRolesOf }),
  // A suspended or terminated org is read-only for its members and the public (M1.3f).
  // M6.6b: after a failed renewal and its grace period, the org's members and API keys are
  // read-only until it pays (billing dormant: no read at all).
  orgGate: composeOrgGates(orgStatusGate, billingReadOnlyGate({ memberRole: memberRoleTx })),
});
