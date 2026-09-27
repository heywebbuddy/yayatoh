import { CurrencyCode, defineSerializer, IanaTimezone, Slug } from '@yayatoh/contracts';
import { z } from 'zod';
import { EVENT_PROFILES, EVENT_ROLES, EVENT_STATUSES, EVENT_VISIBILITIES } from './schema.ts';

export const EventDto = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  tagline: z.string().nullable(),
  profile: z.enum(EVENT_PROFILES),
  status: z.enum(EVENT_STATUSES),
  visibility: z.enum(EVENT_VISIBILITIES),
  timezone: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  venueName: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  currency: z.string(),
  publishedAt: z.date().nullable(),
});
export type EventDto = z.infer<typeof EventDto>;
export const eventSerializer = defineSerializer('events.event', EventDto);

/** What the public event page may show. No org internals, no drafts, no private events. */
export const PublicEventDto = z.object({
  slug: z.string(),
  name: z.string(),
  tagline: z.string().nullable(),
  profile: z.enum(EVENT_PROFILES),
  status: z.enum(EVENT_STATUSES),
  timezone: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  venueName: z.string().nullable(),
  city: z.string().nullable(),
  currency: z.string(),
  organizerName: z.string(),
  poweredByVisible: z.boolean(),
});
export type PublicEventDto = z.infer<typeof PublicEventDto>;
export const publicEventSerializer = defineSerializer('events.publicEvent', PublicEventDto);

const Base = z.object({
  name: z.string().trim().min(2).max(160),
  tagline: z.string().trim().max(280).nullable().default(null),
  profile: z.enum(EVENT_PROFILES).default('other'),
  visibility: z.enum(EVENT_VISIBILITIES).default('public'),
  timezone: IanaTimezone,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  venueName: z.string().trim().max(160).nullable().default(null),
  city: z.string().trim().max(120).nullable().default(null),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .default(null),
  currency: CurrencyCode.default('USD'),
});

export const CreateEventInput = Base.extend({ slug: Slug.optional() }).refine((v) => v.endsAt > v.startsAt, {
  message: 'endsAt must be after startsAt',
  path: ['endsAt'],
});
export type CreateEventInput = z.input<typeof CreateEventInput>;

export const UpdateEventInput = Base.partial()
  .extend({ eventId: z.uuid(), slug: Slug.optional() })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

export const EventRoleDto = z.object({
  eventId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(EVENT_ROLES),
  expiresAt: z.date().nullable(),
});
