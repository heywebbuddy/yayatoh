/** Client-safe exports (no database code): pure schedule helpers for forms and rendering. */

// M5.2a: agenda model v2 (pure helpers and vocabularies for forms and rendering).
export {
  ADMISSIONS,
  AGENDA_CSV_COLUMNS,
  AGENDA_ROW_ERRORS,
  AGENDA_STATES,
  AGENDA_WARNING_KINDS,
  agendaWarnings,
  groupPickDecision,
} from './domain/agenda.ts';
export {
  groupByDay,
  localDay,
  overlaps,
  type ScheduleItem,
  type ScheduleWarning,
  scheduleWarnings,
  warningsFor,
} from './domain/schedule.ts';
export { WARNING_KINDS } from './dto.ts';
