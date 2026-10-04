import { billingEntitlements, billingReadOnlyGate, composeOrgGates } from '@yayatoh/billing';
import { setSessionAccessSource } from '@yayatoh/checkin';
import { eventRolesOf } from '@yayatoh/events';
import { createCommandPorts } from '@yayatoh/platform';
import { registrationSessionAccess } from '@yayatoh/registration';
import { createOrgAuthorizer, memberRoleTx, orgStatusGate } from '@yayatoh/tenancy';
import { configureVirtual, videoProviderFromEnv } from '@yayatoh/virtual';

/** The same composition as the web app: billing entitlements + tenancy authorizer. */
export const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: createOrgAuthorizer({ eventRoles: eventRolesOf }),
  // A suspended or terminated org is read-only for its members and the public (M1.3f).
  // M6.6b: after a failed renewal and its grace period, the org's members and API keys are
  // read-only until it pays (billing dormant: no read at all).
  orgGate: composeOrgGates(orgStatusGate, billingReadOnlyGate({ memberRole: memberRoleTx })),
});

// M5.6a: session doors learn registrations and enrollments from the registration module
// (a higher tier than check-in, so it is plugged in here).
setSessionAccessSource(registrationSessionAccess);

// M6.9a: video for virtual sessions (the Mux fake outside production until the owner's account).
configureVirtual({ provider: videoProviderFromEnv(process.env) });
