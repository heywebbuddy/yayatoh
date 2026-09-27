import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { ATTENDEE_SOURCES, ATTENDEE_STATUSES } from './schema.ts';

/** What organizers see in the attendee list (allowlist; contact ids stay internal). */
export const AttendeeDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  email: z.string(),
  source: z.enum(ATTENDEE_SOURCES),
  status: z.enum(ATTENDEE_STATUSES),
  ticketId: z.uuid().nullable(),
  labels: z.array(z.string()),
  createdAt: z.date(),
});
export type AttendeeDto = z.infer<typeof AttendeeDto>;
export const attendeeSerializer = defineSerializer('attendees.attendee', AttendeeDto);
