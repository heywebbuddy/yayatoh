import { randomBytes } from 'node:crypto';
import { attendeeEmailAction, attendeeImportAction, attendeeLabelAction } from '@yayatoh/attendees';
import { audienceExportAction } from '@yayatoh/audiences';
import { billingEntitlements } from '@yayatoh/billing';
import { eventRolesOf } from '@yayatoh/events';
import { guestImportAction } from '@yayatoh/guests';
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
import { attendeeExportAction, bookingsExportAction } from '@yayatoh/reports';
import { seatAssignAction } from '@yayatoh/seating';
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
] as const;
export const bulkStep = bulkStepCommand(BULK_ACTIONS);
export const runBulk = (orgId: string, operationId: string, budgetMs?: number) =>
  runBulkOperation(bulkStep, ports, orgId, operationId, budgetMs);
