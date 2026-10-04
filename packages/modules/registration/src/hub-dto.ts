import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { FAVORITE_CHOICES } from './domain/hub.ts';
import { MY_SESSION_STATES } from './enrollment-dto.ts';

/** M5.10a DTOs: the attendee's conference hub and calendar feed (allowlists). */

/**
 * One session of the hub's agenda: where it stands for the registrant (M5.2b's states), whether
 * they starred it, whether it is on their personal schedule (enrolled, offered or starred), and
 * the sessions on that schedule it overlaps (the conflict marker).
 */
export const HubSessionDto = z.object({
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
  favorite: z.boolean(),
  onSchedule: z.boolean(),
  conflicts: z.array(z.uuid()),
});
export type HubSessionDto = z.infer<typeof HubSessionDto>;

export const ConferenceHubDto = z.object({
  eventId: z.uuid(),
  eventSlug: z.string(),
  eventName: z.string(),
  timezone: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  venueName: z.string().nullable(),
  registrants: z.array(z.object({ id: z.uuid(), name: z.string() })),
  registrantId: z.uuid().nullable(),
  sessions: z.array(HubSessionDto),
  /** The calendar feed link's current version (the web signs the link). */
  feedVersion: z.int(),
});
export type ConferenceHubDto = z.infer<typeof ConferenceHubDto>;
export const conferenceHubSerializer = defineSerializer('registration.conferenceHub', ConferenceHubDto);

export const FavoriteChoiceSchema = z.enum(FAVORITE_CHOICES);

export const FavoriteResultDto = z.object({
  favorite: z.boolean(),
  /** Favorites un-starred by "replace". */
  removed: z.array(z.uuid()),
});
export type FavoriteResultDto = z.infer<typeof FavoriteResultDto>;

/** One session of the calendar feed: no personal data, no links. */
export const FeedSessionDto = z.object({
  sessionId: z.uuid(),
  title: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  roomName: z.string().nullable(),
  updatedAt: z.date(),
  confirmed: z.boolean(),
});

export const CalendarFeedDto = z.object({
  eventName: z.string(),
  timezone: z.string(),
  sessions: z.array(FeedSessionDto),
});
export type CalendarFeedDto = z.infer<typeof CalendarFeedDto>;
export const calendarFeedSerializer = defineSerializer('registration.calendarFeed', CalendarFeedDto);
