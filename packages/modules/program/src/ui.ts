/** Client-safe exports (no database code): pure schedule helpers for forms and rendering. */
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
