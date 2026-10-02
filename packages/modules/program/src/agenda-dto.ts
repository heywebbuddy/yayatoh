import { z } from 'zod';
import { ADMISSIONS, AGENDA_ROW_ERRORS, AGENDA_STATES, AGENDA_WARNING_KINDS } from './domain/agenda.ts';

/** M5.2a: agenda model v2 (org-scoped console payloads; public output stays in `dto.ts`). */

export const SessionTypeDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  position: z.number().int(),
});
export type SessionTypeDto = z.infer<typeof SessionTypeDto>;

export const SessionGroupDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  /** Sessions in the group, in agenda order. */
  sessionIds: z.array(z.uuid()),
  /** Registrants holding a pick (M5.2b fills it; 0 until then). */
  picks: z.number().int(),
});
export type SessionGroupDto = z.infer<typeof SessionGroupDto>;

export const SessionAgendaDto = z.object({
  sessionId: z.uuid(),
  typeId: z.uuid().nullable(),
  admission: z.enum(ADMISSIONS),
  groupId: z.uuid().nullable(),
  capacity: z.number().int().nullable(),
  enrolled: z.number().int(),
  enrollmentOpen: z.boolean(),
});
export type SessionAgendaDto = z.infer<typeof SessionAgendaDto>;

export const AgendaWarningDto = z.object({
  kind: z.enum(AGENDA_WARNING_KINDS),
  sessionId: z.uuid(),
  roomId: z.uuid().nullable(),
  groupId: z.uuid().nullable(),
  roomCapacity: z.number().int().nullable(),
  sessionCapacity: z.number().int().nullable(),
});
export type AgendaWarningDto = z.infer<typeof AgendaWarningDto>;

export const AgendaPublicationDto = z.object({
  state: z.enum(AGENDA_STATES),
  /** How many times the agenda was published (0: never). */
  version: z.number().int(),
  publishedAt: z.date().nullable(),
  /** Sessions in the published snapshot (null when nothing is published). */
  publishedSessions: z.number().int().nullable(),
});
export type AgendaPublicationDto = z.infer<typeof AgendaPublicationDto>;

/** The console's agenda v2 view of one event (alongside `ProgramDto`). */
export const AgendaDto = z.object({
  types: z.array(SessionTypeDto),
  groups: z.array(SessionGroupDto),
  sessions: z.array(SessionAgendaDto),
  warnings: z.array(AgendaWarningDto),
  publication: AgendaPublicationDto,
});
export type AgendaDto = z.infer<typeof AgendaDto>;

export const SessionAgendaResultDto = z.object({
  agenda: SessionAgendaDto,
  /** Agenda warnings that involve this session after the write (the write still happened). */
  warnings: z.array(AgendaWarningDto),
});
export type SessionAgendaResultDto = z.infer<typeof SessionAgendaResultDto>;

export const AGENDA_IMPORT_ACTIONS = ['create', 'update', 'unchanged', 'error'] as const;

/** One row of an agenda CSV dry run (organizer-facing: the row's own text only). */
export const AgendaImportRowDto = z.object({
  line: z.number().int(),
  action: z.enum(AGENDA_IMPORT_ACTIONS),
  title: z.string(),
  errors: z.array(z.enum(AGENDA_ROW_ERRORS)),
});
export type AgendaImportRowDto = z.infer<typeof AgendaImportRowDto>;

export const AgendaImportResultDto = z.object({
  /** false: a dry run (nothing written). */
  applied: z.boolean(),
  rows: z.array(AgendaImportRowDto),
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  failed: z.number().int(),
});
export type AgendaImportResultDto = z.infer<typeof AgendaImportResultDto>;
