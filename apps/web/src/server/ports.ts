import { attendeesContactOwner } from '@yayatoh/attendees';
import { participationContactOwner } from '@yayatoh/audiences';
import { automationsContactOwner } from '@yayatoh/automations';
import { billingEntitlements } from '@yayatoh/billing';
import { campaignsContactOwner } from '@yayatoh/campaigns';
import { checkinContactOwner, setSessionAccessSource } from '@yayatoh/checkin';
import { registerContactReferenceOwners } from '@yayatoh/crm';
import { engagementContactOwner } from '@yayatoh/engagement';
import { eventRolesOf } from '@yayatoh/events';
import { guestsContactOwner, guestsOccupantDirectory, guestsPartyCredentials } from '@yayatoh/guests';
import { notificationsContactOwner } from '@yayatoh/notifications';
import { ordersContactOwner } from '@yayatoh/orders';
import {
  createCommandPorts,
  localKeyVault,
  registerDataSubjectContributors,
  setKeyVault,
} from '@yayatoh/platform';
import { defaultResolver } from '@yayatoh/platform/ssrf';
import { registrationSessionAccess } from '@yayatoh/registration';
import { setOccupantDirectory, setPartyCredentials } from '@yayatoh/seating';
import { surveysContactOwner } from '@yayatoh/surveys';
import { createOrgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
import { ticketingContactOwner } from '@yayatoh/ticketing';
import { configureWebhooks, fakeResolver, webhookPublisherFromEnv } from '@yayatoh/webhooks';
import { DATA_SUBJECT_CONTRIBUTORS } from './data-subjects.ts';

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

// M6.1c: data-subject requests run every module's contributor (find, export, erase).
registerDataSubjectContributors(DATA_SUBJECT_CONTRIBUTORS);

// M6.1a contact merges: every module holding contact references moves its own rows inside the
// merge's transaction (ADR 0023). The merge refuses while any contact column has no owner.
registerContactReferenceOwners([
  attendeesContactOwner,
  notificationsContactOwner,
  guestsContactOwner,
  ordersContactOwner,
  ticketingContactOwner,
  checkinContactOwner,
  surveysContactOwner,
  campaignsContactOwner,
  automationsContactOwner,
  engagementContactOwner,
  participationContactOwner,
]);
// M6.3b: outbound webhooks through Svix, or the fake (dev, preview, CI) until the owner's account.
const webhookPublisher = webhookPublisherFromEnv(
  process.env,
  process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.BETTER_AUTH_URL || 'http://localhost:3000',
);
configureWebhooks({
  publisher: webhookPublisher,
  resolver: webhookPublisher?.name === 'fake' ? fakeResolver : defaultResolver,
});

// M4.3a: seating reaches the guest list through its OccupantDirectory port (same tier).
setOccupantDirectory(guestsOccupantDirectory);
// M4.4a: the guest seat finder checks party links and PINs through its PartyCredentials port.
setPartyCredentials(guestsPartyCredentials);
// M5.6a: session doors learn registrations and enrollments from the registration module
// (a higher tier than check-in, so it is plugged in here).
setSessionAccessSource(registrationSessionAccess);
