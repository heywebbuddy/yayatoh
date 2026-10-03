import { randomBytes } from 'node:crypto';
import { attendeeEmailAction, attendeeImportAction, attendeeLabelAction } from '@yayatoh/attendees';
import { audienceExportAction } from '@yayatoh/audiences';
import { billingEntitlements, billingReadOnlyGate, composeOrgGates } from '@yayatoh/billing';
import { recordTermConsentTx } from '@yayatoh/crm';
import { giftsExportAction } from '@yayatoh/donations';
import { eventRolesOf } from '@yayatoh/events';
import { submitRegistrationFormCommand } from '@yayatoh/forms';
import { guestImportAction, rsvpAnswersExportAction, rsvpAnswersPrivateExportAction } from '@yayatoh/guests';
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
import { registrationDecideAction } from '@yayatoh/registration';
import { attendeeExportAction, bookingsExportAction } from '@yayatoh/reports';
import { seatAssignAction } from '@yayatoh/seating';
import { surveyExportAction } from '@yayatoh/surveys';
import { createOrgAuthorizer, memberRoleTx, orgStatusGate } from '@yayatoh/tenancy';
import { ticketResendAction } from '@yayatoh/ticketing';

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
] as const;
export const bulkStep = bulkStepCommand(BULK_ACTIONS);
export const runBulk = (orgId: string, operationId: string, budgetMs?: number) =>
  runBulkOperation(bulkStep, ports, orgId, operationId, budgetMs);

/** Registration form submit (M5.1b) with the crm consent ledger, composed like the web's. */
export const submitRegistrationForm = submitRegistrationFormCommand({ recordConsent: recordTermConsentTx });
