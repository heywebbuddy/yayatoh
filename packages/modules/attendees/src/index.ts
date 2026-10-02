export {
  AttendeeFilter,
  AttendeeHitDto,
  AttendeeListDto,
  addAttendeeLabelsTx,
  attendeeLabelsQuery,
  attendeesByIdsTx,
  attendeesByTicketIdsTx,
  cancelAttendeesTx,
  createAttendeesTx,
  eventAttendeesMatchingTx,
  eventAttendeesTx,
  getAttendeeQuery,
  Label as AttendeeLabel,
  ListAttendeesInput,
  listAttendeesQuery,
  listAttendeesTx,
  MAX_LABELS,
  type NewAttendee,
  normalizePersonName,
  reassignAttendeeTx,
  searchAttendeesQuery,
  setAttendeeLabelsCommand,
  type TicketFilterExtension,
} from './attendees.ts';
export {
  attendeeLabelAction,
  attendeeLabelBulk,
  attendeesForExportTx,
  resolveAttendeeIdsTx,
} from './bulk.ts';
// M6.1a: contact merges move this module's references (ADR 0022).
export { attendeesByTicketTx, attendeesContactOwner } from './contact-merge.ts';
export { attendeesDsarTx, eraseAttendeesDsarTx, redactAttendeesForEventsTx } from './dsar.ts';
export * from './dto.ts';
export {
  addGuestCommand,
  attendeeEmailAction,
  attendeeEmailBulk,
  attendeeMessageMailer,
  contactAttendancesTx,
  removeGuestCommand,
} from './guests.ts';
export {
  attendeeImportAction,
  attendeeImportBulk,
  guessMapping,
  IMPORT_ERROR_CODES,
  type ImportErrorCode,
  ImportSummaryDto,
  importFailuresQuery,
  importSummaryQuery,
  stageImportCommand,
  validateImportCommand,
} from './imports.ts';
export { attendeeContactIdsTx, emitAttendeesChangedTx, participationAttendeesTx } from './participation.ts';
export { privateColumns } from './private-columns.ts';
export { ATTENDEE_SOURCES, ATTENDEE_STATUSES, IMPORT_FIELDS, type ImportField } from './schema.ts';
