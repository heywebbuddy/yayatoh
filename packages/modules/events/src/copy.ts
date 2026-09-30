import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { markOnboardingStepTx } from '@yayatoh/tenancy';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { slugify } from './domain/lifecycle.ts';
import { EventDto } from './dto.ts';
import { EVENT_PROFILES, EVENT_VISIBILITIES, events, occurrences } from './schema.ts';

/**
 * M1.4b duplicate / templates: the event settings a copy takes over. Times are kept as a duration
 * only; the copy gets its own start. Never status, slug, dates of sale or anything sold.
 */
export const EventSettingsSnapshot = z.object({
  profile: z.enum(EVENT_PROFILES),
  visibility: z.enum(EVENT_VISIBILITIES),
  timezone: z.string(),
  tagline: z.string().nullable(),
  venueName: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  currency: z.string(),
  durationMs: z.int().min(60_000),
});
export type EventSettingsSnapshot = z.infer<typeof EventSettingsSnapshot>;

export async function eventSettingsTx(
  tx: TenantTx,
  eventId: string,
): Promise<{ name: string; startsAt: Date; settings: EventSettingsSnapshot }> {
  const [ev] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!ev) throw new DomainError('not_found', 'Event not found');
  // A multi-date event's own times span all its dates: a copy takes the first date's length.
  const [first] = await tx
    .select({ startsAt: occurrences.startsAt, endsAt: occurrences.endsAt })
    .from(occurrences)
    .where(and(eq(occurrences.eventId, eventId), eq(occurrences.status, 'scheduled')))
    .orderBy(asc(occurrences.startsAt))
    .limit(1);
  const span = first ?? ev;
  return {
    name: ev.name,
    startsAt: span.startsAt,
    settings: EventSettingsSnapshot.parse({
      profile: ev.profile,
      visibility: ev.visibility,
      timezone: ev.timezone,
      tagline: ev.tagline,
      venueName: ev.venueName,
      city: ev.city,
      country: ev.country,
      currency: ev.currency,
      durationMs: span.endsAt.getTime() - span.startsAt.getTime(),
    }),
  };
}

/** Insert a draft event copying `settings`, with a new name, a free slug and its own start. */
export async function insertEventCopyTx(
  tx: TenantTx,
  ctx: Ctx,
  input: { name: string; startsAt: Date; settings: EventSettingsSnapshot },
): Promise<EventDto> {
  const orgId = requireOrg(ctx);
  const { durationMs, ...settings } = input.settings;
  const base = slugify(input.name);
  // Slugs are global and other orgs' rows are invisible under RLS: try the name's slug, then
  // numbered ones, each in a savepoint so a taken slug does not abort the transaction.
  for (let n = 1; n <= 20; n++) {
    const slug = n === 1 ? base : `${base.slice(0, 72)}-${n}`;
    try {
      const row = await tx.transaction(async (sp) => {
        const [r] = await sp
          .insert(events)
          .values({
            ...settings,
            orgId,
            name: input.name,
            slug,
            status: 'draft',
            startsAt: input.startsAt,
            endsAt: new Date(input.startsAt.getTime() + durationMs),
          })
          .returning();
        return r;
      });
      if (!row) throw new DomainError('internal');
      await markOnboardingStepTx(tx, 'event', ctx.now);
      return EventDto.parse(row);
    } catch (err) {
      if (!isUniqueViolation(err, 'events_slug_key')) throw err;
    }
  }
  throw new DomainError('conflict', 'This event address is already taken', { field: 'name' });
}
