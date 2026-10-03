import { randomBytes } from 'node:crypto';
import { attendeeEmailAction, attendeeImportAction, attendeeLabelAction } from '@yayatoh/attendees';
import { audienceExportAction } from '@yayatoh/audiences';
import { billingEntitlements } from '@yayatoh/billing';
import { setSessionAccessSource } from '@yayatoh/checkin';
import { recordTermConsentTx } from '@yayatoh/crm';
import {
  donorCsvExportAction,
  donorXlsxExportAction,
  employerExportAction,
  giftsExportAction,
} from '@yayatoh/donations';
import { eventRolesOf } from '@yayatoh/events';
import { submitRegistrationFormCommand } from '@yayatoh/forms';
import {
  guestImportAction,
  guestsOccupantDirectory,
  guestsPartyCredentials,
  rsvpAnswersExportAction,
  rsvpAnswersPrivateExportAction,
} from '@yayatoh/guests';
import { ticketCancelAction, waitlistExportAction } from '@yayatoh/orders';
import {
  auditExportAction,
  bulkStepCommand,
  createCommandPorts,
  localKeyVault,
  runBulkOperation,
  setKeyVault,
} from '@yayatoh/platform';
import { dsarExportAction } from '@yayatoh/privacy';
import { registrationDecideAction, registrationSessionAccess } from '@yayatoh/registration';
import { attendeeExportAction, bookingsExportAction } from '@yayatoh/reports';
import { seatAssignAction, setOccupantDirectory, setPartyCredentials } from '@yayatoh/seating';
import { surveyExportAction } from '@yayatoh/surveys';
import { createOrgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
import { ticketResendAction } from '@yayatoh/ticketing';

/** The same composition the apps use: billing entitlements + tenancy authorizer. */
export const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: createOrgAuthorizer({ eventRoles: eventRolesOf }),
  // A suspended or terminated org is read-only for its members and the public (M1.3f).
  orgGate: orgStatusGate,
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

/** The bulk actions the apps register, and the step command built from them. */
export const BULK_ACTIONS = [
  attendeeLabelAction,
  attendeeImportAction,
  attendeeEmailAction,
  attendeeExportAction,
  bookingsExportAction,
  auditExportAction,
  dsarExportAction,
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
  donorCsvExportAction,
  donorXlsxExportAction,
] as const;
export const bulkStep = bulkStepCommand(BULK_ACTIONS);
export const runBulk = (orgId: string, operationId: string, budgetMs?: number) =>
  runBulkOperation(bulkStep, ports, orgId, operationId, budgetMs);

/** Registration form submit (M5.1b) with the crm consent ledger, composed like the web's. */
export const submitRegistrationForm = submitRegistrationFormCommand({ recordConsent: recordTermConsentTx });
