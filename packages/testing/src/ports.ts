import { randomBytes } from 'node:crypto';
import {
  attendeeEmailAction,
  attendeeImportAction,
  attendeeLabelAction,
  attendeesContactOwner,
} from '@yayatoh/attendees';
import { audienceExportAction, participationContactOwner } from '@yayatoh/audiences';
import { automationsContactOwner } from '@yayatoh/automations';
import { billingEntitlements, billingReadOnlyGate, composeOrgGates } from '@yayatoh/billing';
import { campaignsContactOwner } from '@yayatoh/campaigns';
import { checkinContactOwner, setSessionAccessSource } from '@yayatoh/checkin';
import { recordTermConsentTx, registerContactReferenceOwners } from '@yayatoh/crm';
import { employerExportAction, giftsExportAction } from '@yayatoh/donations';
import { engagementContactOwner } from '@yayatoh/engagement';
import { eventRolesOf } from '@yayatoh/events';
import { submitRegistrationFormCommand } from '@yayatoh/forms';
import {
  guestImportAction,
  guestsContactOwner,
  guestsOccupantDirectory,
  guestsPartyCredentials,
  rsvpAnswersExportAction,
  rsvpAnswersPrivateExportAction,
} from '@yayatoh/guests';
import { notificationsContactOwner } from '@yayatoh/notifications';
import { ordersContactOwner, ticketCancelAction, waitlistExportAction } from '@yayatoh/orders';
import {
  auditExportAction,
  bulkStepCommand,
  createCommandPorts,
  localKeyVault,
  registerDataSubjectContributors,
  runBulkOperation,
  setKeyVault,
} from '@yayatoh/platform';
import { registrationDecideAction, registrationSessionAccess } from '@yayatoh/registration';
import { attendeeExportAction, bookingsExportAction } from '@yayatoh/reports';
import { seatAssignAction, setOccupantDirectory, setPartyCredentials } from '@yayatoh/seating';
import { surveyExportAction, surveysContactOwner } from '@yayatoh/surveys';
import { createOrgAuthorizer, memberRoleTx, orgStatusGate } from '@yayatoh/tenancy';
import { ticketResendAction } from '@yayatoh/ticketing';
import {
  configureWebhooks,
  type FakePublisher,
  fakePublisher,
  fakeResolver,
  memoryWebhookStore,
} from '@yayatoh/webhooks';
import { DATA_SUBJECT_CONTRIBUTORS } from './dsar/contributors.ts';

/** The same composition the apps use: billing entitlements + tenancy authorizer. */
export const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: createOrgAuthorizer({ eventRoles: eventRolesOf }),
  // A suspended or terminated org is read-only for its members and the public (M1.3f).
  // M6.6b: after a failed renewal and its grace period, the org's members and API keys are
  // read-only until it pays (billing dormant: no read at all).
  orgGate: composeOrgGates(orgStatusGate, billingReadOnlyGate({ memberRole: memberRoleTx })),
});

// Tests get a per-run local key vault (ticket signing keys are envelope-encrypted). Integration
// runs share one key across files (the global setup provides it); unit runs draw their own.
setKeyVault(localKeyVault(process.env.LOCAL_KMS_KEY ?? randomBytes(32).toString('hex')));
// M4.3a: guest seating reads the guest list through seating's OccupantDirectory port.
setOccupantDirectory(guestsOccupantDirectory);
// M4.4a: the guest seat finder's party links and PINs (seating's PartyCredentials port).
setPartyCredentials(guestsPartyCredentials);

// M5.6a: session doors learn registrations and enrollments from the registration module.
setSessionAccessSource(registrationSessionAccess);

// M6.1c: every module's data-subject contributor, as the web registers them.
registerDataSubjectContributors(DATA_SUBJECT_CONTRIBUTORS);
/** M6.3b: outbound webhooks go to the fake publisher (deliveries recorded, never sent). */
export const webhookPublisher: FakePublisher = fakePublisher({
  seed: randomBytes(32).toString('hex'),
  appOrigin: 'https://app.yayatoh.test',
  store: memoryWebhookStore(),
});
configureWebhooks({ publisher: webhookPublisher, resolver: fakeResolver });

/** The bulk actions the apps register, and the step command built from them. */
export const BULK_ACTIONS = [
  attendeeLabelAction,
  attendeeImportAction,
  attendeeEmailAction,
  attendeeExportAction,
  bookingsExportAction,
  auditExportAction,
  seatAssignAction,
  ticketResendAction,
  ticketCancelAction,
  surveyExportAction,
  audienceExportAction,
  waitlistExportAction,
  guestImportAction,
  registrationDecideAction,
  rsvpAnswersExportAction,
  rsvpAnswersPrivateExportAction,
  giftsExportAction,
  employerExportAction,
] as const;
export const bulkStep = bulkStepCommand(BULK_ACTIONS);
export const runBulk = (orgId: string, operationId: string, budgetMs?: number) =>
  runBulkOperation(bulkStep, ports, orgId, operationId, budgetMs);

/** Registration form submit (M5.1b) with the crm consent ledger, composed like the web's. */
export const submitRegistrationForm = submitRegistrationFormCommand({ recordConsent: recordTermConsentTx });

/**
 * M6.1a contact merges: every module holding contact references, registered like the web's
 * (apps/web/src/server/ports.ts). The merge refuses while a contact column has no owner.
 */
export const CONTACT_REFERENCE_OWNERS = [
  attendeesContactOwner,
  notificationsContactOwner,
  guestsContactOwner,
  ordersContactOwner,
  checkinContactOwner,
  surveysContactOwner,
  campaignsContactOwner,
  automationsContactOwner,
  engagementContactOwner,
  participationContactOwner,
] as const;
registerContactReferenceOwners(CONTACT_REFERENCE_OWNERS);
