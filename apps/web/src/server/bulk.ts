import 'server-only';
import { attendeeEmailAction, attendeeImportAction, attendeeLabelAction } from '@yayatoh/attendees';
import { ticketCancelAction, waitlistExportAction } from '@yayatoh/orders';
import { auditExportAction, bulkStepCommand, runBulkOperation } from '@yayatoh/platform';
import { dsarExportAction } from '@yayatoh/privacy';
import { attendeeExportAction, bookingsExportAction } from '@yayatoh/reports';
import { seatAssignAction } from '@yayatoh/seating';
import { surveyExportAction } from '@yayatoh/surveys';
import { ticketResendAction } from '@yayatoh/ticketing';
import { ports } from './ports.ts';

/** Every bulk action the console offers (the worker registers the same list). */
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
  waitlistExportAction,
] as const;
const step = bulkStepCommand(BULK_ACTIONS);

/**
 * Run an operation for up to 3 s in the request that started it, so small jobs finish before
 * the page reloads; the worker carries on with anything bigger.
 */
export const runBulkInline = (orgId: string, operationId: string) =>
  runBulkOperation(step, ports, orgId, operationId, 3_000);
