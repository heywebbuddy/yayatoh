import { billingEntitlements } from '@yayatoh/billing';
import { eventRolesOf } from '@yayatoh/events';
import { guestsOccupantDirectory, guestsPartyCredentials } from '@yayatoh/guests';
import { createCommandPorts, localKeyVault, setKeyVault } from '@yayatoh/platform';
import { setOccupantDirectory, setPartyCredentials } from '@yayatoh/seating';
import { createOrgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';

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

// M4.3a: seating reaches the guest list through its OccupantDirectory port (same tier).
setOccupantDirectory(guestsOccupantDirectory);
// M4.4a: the guest seat finder checks party links and PINs through its PartyCredentials port.
setPartyCredentials(guestsPartyCredentials);
