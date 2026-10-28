import { z } from 'zod';

export const APPLICATION_KINDS = ['apply', 'demo'] as const;
export type ApplicationKind = (typeof APPLICATION_KINDS)[number];

export const APPLICATION_STATUSES = ['new', 'in_review', 'approved', 'rejected', 'needs_info'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const ORG_TYPES = [
  'company',
  'nonprofit',
  'agency',
  'venue',
  'school',
  'community',
  'individual',
  'other',
] as const;

export const EVENT_TYPES = [
  'conference',
  'gala',
  'wedding',
  'festival',
  'workshop',
  'sports',
  'fundraiser',
  'other',
] as const;

export const EVENTS_PER_YEAR = ['1-5', '6-20', '21-100', '100+'] as const;
export const EXPECTED_TICKETS = ['lt500', '500-5000', '5000-50000', 'gt50000'] as const;

/** The plans an applicant can ask about (the landing page's four columns). */
export const PLAN_INTERESTS = ['starter', 'pro', 'white_label', 'enterprise', 'unsure'] as const;

/**
 * Where an application may go next. Approved is final; a rejected one can be reopened (a person
 * writes back with new facts), which keeps the whole history on one record.
 */
const NEXT: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  new: ['in_review', 'approved', 'rejected', 'needs_info'],
  in_review: ['approved', 'rejected', 'needs_info'],
  needs_info: ['in_review', 'approved', 'rejected'],
  rejected: ['in_review'],
  approved: [],
};
export const canTransition = (from: ApplicationStatus, to: ApplicationStatus) => NEXT[from].includes(to);
export const nextStatuses = (from: ApplicationStatus): readonly ApplicationStatus[] => NEXT[from];

const text = (max: number) => z.string().trim().max(max);
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/** What the landing page's form sends. Everything is checked again by the database. */
export const ApplicationInput = z
  .object({
    kind: z.enum(APPLICATION_KINDS),
    orgName: text(160).min(2),
    orgType: z.enum(ORG_TYPES),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    website: z.preprocess(
      blankToUndefined,
      z
        .string()
        .trim()
        .max(200)
        .regex(/^https?:\/\/[^\s]+\.[^\s]+$/i)
        .optional(),
    ),
    contactName: text(120).min(2),
    contactEmail: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    contactPhone: z.preprocess(blankToUndefined, text(40).optional()),
    eventTypes: z.array(z.enum(EVENT_TYPES)).min(1).max(EVENT_TYPES.length),
    eventsPerYear: z.enum(EVENTS_PER_YEAR),
    expectedTickets: z.enum(EXPECTED_TICKETS),
    planInterest: z.enum(PLAN_INTERESTS),
    whiteLabel: z.boolean(),
    message: z.preprocess(blankToUndefined, text(2000).optional()),
    /** Demos only: when the applicant would like to meet (an ISO instant) and their time zone. */
    preferredTime: z.preprocess(blankToUndefined, z.iso.datetime({ offset: true }).optional()),
    timezone: z.preprocess(blankToUndefined, text(64).optional()),
    locale: z.string().trim().min(2).max(10),
  })
  .refine((v) => v.kind !== 'demo' || Boolean(v.preferredTime), {
    path: ['preferredTime'],
    message: 'preferred_time_required',
  });
export type ApplicationInput = z.infer<typeof ApplicationInput>;

export const NoteInput = z.object({ body: z.string().trim().min(1).max(2000) });

/** Days an approved invitation stays valid. */
export const INVITATION_DAYS = 14;
