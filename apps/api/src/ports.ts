import { billingEntitlements } from '@yayatoh/billing';
import { setSessionAccessSource } from '@yayatoh/checkin';
import { eventRolesOf } from '@yayatoh/events';
import { createCommandPorts } from '@yayatoh/platform';
import { registrationSessionAccess } from '@yayatoh/registration';
import { createOrgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
import { configureVirtual, videoProvidersFromEnv } from '@yayatoh/virtual';

/** The same composition as the web app: billing entitlements + tenancy authorizer. */
export const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: createOrgAuthorizer({ eventRoles: eventRolesOf }),
  // A suspended or terminated org is read-only for its members and the public (M1.3f).
  orgGate: orgStatusGate,
});

// M5.6a: session doors learn registrations and enrollments from the registration module
// (a higher tier than check-in, so it is plugged in here).
setSessionAccessSource(registrationSessionAccess);

// M6.9a/M6.10a: video for virtual sessions (the Mux and Cloudflare Stream fakes outside
// production until the owner's accounts).
configureVirtual({ providers: videoProvidersFromEnv(process.env) });
