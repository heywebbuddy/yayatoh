import { defineSerializer } from '@yayatoh/contracts';
import { PortalAccountDto } from '@yayatoh/events';
import { z } from 'zod';
import { LinkDto } from './dto.ts';
import { CHANGE_STATUSES, TASK_KINDS } from './schema-portal.ts';

/* ------------------------------------------------------------------ organizer side ---- */

export const SpeakerAccessDto = z.object({
  speakerId: z.uuid(),
  accounts: z.array(PortalAccountDto),
});
export type SpeakerAccessDto = z.infer<typeof SpeakerAccessDto>;

export const FieldChangeDto = z.object({
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});

export const SpeakerChangeDto = z.object({
  id: z.uuid(),
  speakerId: z.uuid(),
  speakerName: z.string(),
  sessionId: z.uuid().nullable(),
  sessionTitle: z.string().nullable(),
  status: z.enum(CHANGE_STATUSES),
  changes: z.array(FieldChangeDto),
  photoFileId: z.uuid().nullable(),
  /** Fields the organizer changed after the proposal (approving would overwrite them). */
  stale: z.array(z.string()),
  createdAt: z.date(),
  decidedAt: z.date().nullable(),
  note: z.string().nullable(),
});
export type SpeakerChangeDto = z.infer<typeof SpeakerChangeDto>;

export const TaskAssigneeDto = z.object({
  id: z.uuid(),
  subjectId: z.uuid(),
  subjectName: z.string(),
  status: z.enum(['open', 'done']),
  completedAt: z.date().nullable(),
  fileId: z.uuid().nullable(),
  fileName: z.string().nullable(),
  remindedAt: z.date().nullable(),
  reminderCount: z.number().int(),
  /** Whether anyone can be emailed for this subject (a live portal account). */
  reachable: z.boolean(),
});
export type TaskAssigneeDto = z.infer<typeof TaskAssigneeDto>;

export const PortalTaskDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  kind: z.enum(TASK_KINDS),
  title: z.string(),
  instructions: z.string(),
  agreementText: z.string().nullable(),
  dueAt: z.date(),
  assignees: z.array(TaskAssigneeDto),
});
export type PortalTaskDto = z.infer<typeof PortalTaskDto>;

export const RemindResultDto = z.object({
  /** Messages queued (one per assignee and live account). */
  recipients: z.number().int(),
  /** Assignees missing the task with nobody to email. */
  unreachable: z.number().int(),
});
export type RemindResultDto = z.infer<typeof RemindResultDto>;

/* --------------------------------------------------------------------- portal side ---- */

const PortalChangeSummary = z.object({
  id: z.uuid(),
  status: z.enum(CHANGE_STATUSES),
  changes: z.array(FieldChangeDto),
  hasPhoto: z.boolean(),
  note: z.string().nullable(),
  createdAt: z.date(),
  decidedAt: z.date().nullable(),
});

/**
 * What a speaker sees in the portal: their own event, profile, sessions (rooms and times in the
 * event's timezone) and tasks. Allowlisted: no capacities, no other speakers' data beyond names
 * on their own sessions, no org internals.
 */
export const SpeakerPortalDto = z.object({
  event: z.object({
    name: z.string(),
    timezone: z.string(),
    startsAt: z.date(),
    endsAt: z.date(),
    venueName: z.string().nullable(),
  }),
  speaker: z.object({
    id: z.uuid(),
    name: z.string(),
    title: z.string().nullable(),
    company: z.string().nullable(),
    bio: z.string(),
    links: z.array(LinkDto),
  }),
  profileChange: PortalChangeSummary.nullable(),
  sessions: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      description: z.string(),
      startsAt: z.date(),
      endsAt: z.date(),
      room: z.string().nullable(),
      track: z.string().nullable(),
      coSpeakers: z.array(z.string()),
      change: PortalChangeSummary.nullable(),
    }),
  ),
  tasks: z.array(
    z.object({
      assigneeId: z.uuid(),
      kind: z.enum(TASK_KINDS),
      title: z.string(),
      instructions: z.string(),
      agreementText: z.string().nullable(),
      dueAt: z.date(),
      status: z.enum(['open', 'done']),
      completedAt: z.date().nullable(),
      fileName: z.string().nullable(),
    }),
  ),
});
export type SpeakerPortalDto = z.infer<typeof SpeakerPortalDto>;
export const speakerPortalSerializer = defineSerializer('program.speakerPortal', SpeakerPortalDto);

export const ProposalResultDto = z.object({ changeId: z.uuid(), changed: z.array(z.string()) });
export type ProposalResultDto = z.infer<typeof ProposalResultDto>;
