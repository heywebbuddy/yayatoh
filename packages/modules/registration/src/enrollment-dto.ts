import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { CONFLICT_CHOICES } from './domain/enrollment.ts';
import { PROMOTION_MODES } from './schema.ts';

/** M5.2b DTOs: the organizer's enrollment page and the attendee's "My schedule" (allowlists). */

export const EnrollmentSettingsDto = z.object({
  promotion: z.enum(PROMOTION_MODES),
  offerMinutes: z.int(),
});
export type EnrollmentSettingsDto = z.infer<typeof EnrollmentSettingsDto>;

/** One session as the organizer sees its places and line. */
export const SessionEnrollmentStatsDto = z.object({
  sessionId: z.uuid(),
  title: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  roomName: z.string().nullable(),
  groupName: z.string().nullable(),
  admission: z.enum(['included', 'optional']),
  capacity: z.int().nullable(),
  enrolled: z.int(),
  enrollmentOpen: z.boolean(),
  waiting: z.int(),
  offered: z.int(),
  promotionClosesAt: z.date(),
  promotionOpen: z.boolean(),
});
export type SessionEnrollmentStatsDto = z.infer<typeof SessionEnrollmentStatsDto>;

/** An admission item and the sessions it lists (`all`: an admission item listing none). */
export const ItemSessionsDto = z.object({
  admissionItemId: z.uuid(),
  name: z.string(),
  kind: z.enum(['admission', 'add_on']),
  all: z.boolean(),
  sessionIds: z.array(z.uuid()),
});
export type ItemSessionsDto = z.infer<typeof ItemSessionsDto>;

export const EnrollmentOverviewDto = z.object({
  eventId: z.uuid(),
  timezone: z.string(),
  settings: EnrollmentSettingsDto,
  sessions: z.array(SessionEnrollmentStatsDto),
  items: z.array(ItemSessionsDto),
});
export type EnrollmentOverviewDto = z.infer<typeof EnrollmentOverviewDto>;
export const enrollmentOverviewSerializer = defineSerializer(
  'registration.enrollment',
  EnrollmentOverviewDto,
);

/**
 * Where one session stands for the attendee. `included`: on their schedule, no enrollment;
 * `enrolled`, `offered` (accept by `offerExpiresAt`), `waiting` (`position` in line); not held:
 * `open` (enrol now), `full` (join the line), `waitlist_closed` (full, the line stopped 24 h
 * before), `closed` (the organizer closed enrollment), `started`.
 */
export const MY_SESSION_STATES = [
  'included',
  'enrolled',
  'offered',
  'waiting',
  'open',
  'full',
  'waitlist_closed',
  'closed',
  'started',
] as const;
export type MySessionState = (typeof MY_SESSION_STATES)[number];

export const MySessionDto = z.object({
  sessionId: z.uuid(),
  title: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  roomName: z.string().nullable(),
  groupName: z.string().nullable(),
  admission: z.enum(['included', 'optional']),
  state: z.enum(MY_SESSION_STATES),
  position: z.int().nullable(),
  offerExpiresAt: z.date().nullable(),
});
export type MySessionDto = z.infer<typeof MySessionDto>;

export const MyScheduleDto = z.object({
  eventName: z.string(),
  timezone: z.string(),
  registrants: z.array(z.object({ id: z.uuid(), name: z.string() })),
  registrantId: z.uuid().nullable(),
  sessions: z.array(MySessionDto),
});
export type MyScheduleDto = z.infer<typeof MyScheduleDto>;
export const myScheduleSerializer = defineSerializer('registration.mySchedule', MyScheduleDto);

export const EnrollResultDto = z.object({
  status: z.enum(['enrolled', 'waiting', 'offered']),
  position: z.int().nullable(),
  replaced: z.array(z.uuid()),
});
export type EnrollResultDto = z.infer<typeof EnrollResultDto>;

export const ConflictChoiceSchema = z.enum(CONFLICT_CHOICES);
