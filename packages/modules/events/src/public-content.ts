import { withoutTenant, withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { toSectionDto } from './commands/content.ts';
import {
  type HolderEventContentDto,
  holderEventContentSerializer,
  type PublicEventContentDto,
  publicEventContentSerializer,
} from './dto-content.ts';
import { events } from './schema.ts';
import { eventAnnouncements, eventPrivateInfo, eventSections } from './schema-content.ts';

export interface EventTarget {
  readonly orgId: string;
  readonly eventId: string;
}

/**
 * Server-side only: the org and id of an event that has a public page (the same rule as
 * `events.public_event`), so the page can read its content under that org's RLS.
 */
export async function pageTarget(slug: string): Promise<EventTarget | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; event_id: string }>(
      sql`select org_id, event_id from events.page_target(${slug})`,
    ),
  );
  const r = rows[0];
  return r ? { orgId: r.org_id, eventId: r.event_id } : null;
}

/**
 * Server-side only: a live (published or postponed) event of any visibility, for access codes.
 * A private event's page is only shown after a code unlocked it.
 */
export async function accessTarget(
  slug: string,
): Promise<(EventTarget & { visibility: 'public' | 'unlisted' | 'private' }) | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; event_id: string; visibility: 'public' | 'unlisted' | 'private' }>(
      sql`select org_id, event_id, visibility from events.access_target(${slug})`,
    ),
  );
  const r = rows[0];
  return r ? { orgId: r.org_id, eventId: r.event_id, visibility: r.visibility } : null;
}

const announcementCols = {
  id: eventAnnouncements.id,
  title: eventAnnouncements.title,
  body: eventAnnouncements.body,
  audience: eventAnnouncements.audience,
  pinned: eventAnnouncements.pinned,
  publishedAt: eventAnnouncements.publishedAt,
};

/**
 * The public page's content: visible sections in order and published public announcements
 * (pinned first, newest first). Never reads `event_private_info`.
 */
export async function publicEventContent(target: EventTarget): Promise<PublicEventContentDto> {
  return withTenant(createCtx({ orgId: target.orgId }), async (tx) => {
    const sections = await tx
      .select()
      .from(eventSections)
      .where(and(eq(eventSections.eventId, target.eventId), eq(eventSections.visible, true)))
      .orderBy(asc(eventSections.position));
    const announcements = await tx
      .select(announcementCols)
      .from(eventAnnouncements)
      .where(
        and(
          eq(eventAnnouncements.eventId, target.eventId),
          eq(eventAnnouncements.audience, 'public'),
          isNotNull(eventAnnouncements.publishedAt),
        ),
      )
      .orderBy(desc(eventAnnouncements.pinned), desc(eventAnnouncements.publishedAt));
    return publicEventContentSerializer.serialize({
      sections: sections.map((s) => {
        const d = toSectionDto(s);
        return { id: d.id, title: d.title, kind: d.kind, content: d.content };
      }),
      announcements,
    });
  });
}

/**
 * The attendee portal (`/my-tickets/{token}`): private info, every published announcement and,
 * for online/hybrid events, the join link inside its window only (from `join_opens_minutes`
 * before the start until the end). Call it only after the holder link was verified and the
 * holder has a live ticket for this event.
 */
export async function holderEventContent(
  target: EventTarget,
  now: Date = new Date(),
): Promise<HolderEventContentDto | null> {
  return withTenant(createCtx({ orgId: target.orgId }), async (tx) => {
    const [event] = await tx
      .select({ startsAt: events.startsAt, endsAt: events.endsAt, attendanceMode: events.attendanceMode })
      .from(events)
      .where(eq(events.id, target.eventId));
    if (!event) return null;
    const [info] = await tx
      .select()
      .from(eventPrivateInfo)
      .where(eq(eventPrivateInfo.eventId, target.eventId));
    const announcements = await tx
      .select(announcementCols)
      .from(eventAnnouncements)
      .where(and(eq(eventAnnouncements.eventId, target.eventId), isNotNull(eventAnnouncements.publishedAt)))
      .orderBy(desc(eventAnnouncements.pinned), desc(eventAnnouncements.publishedAt));
    const online = event.attendanceMode !== 'in_person' && Boolean(info?.joinUrl);
    const opensAt = info ? new Date(event.startsAt.getTime() - info.joinOpensMinutes * 60_000) : null;
    const open = online && opensAt !== null && now >= opensAt && now < event.endsAt;
    return holderEventContentSerializer.serialize({
      privateInfo: info?.body ?? '',
      attendanceMode: event.attendanceMode,
      joinUrl: open ? (info?.joinUrl ?? null) : null,
      joinOpensAt: online && opensAt && now < opensAt ? opensAt : null,
      joinClosed: online && now >= event.endsAt,
      announcements,
    });
  });
}

export interface VenueEventDto {
  readonly slug: string;
  readonly name: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timezone: string;
}

/** Upcoming public events at a directory venue (cross-tenant, SECURITY DEFINER; unlisted/private never). */
export async function publicEventsAtVenue(venueSlug: string): Promise<VenueEventDto[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ slug: string; name: string; starts_at: string; ends_at: string; timezone: string }>(
      sql`select * from events.public_events_at_venue(${venueSlug})`,
    ),
  );
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    timezone: r.timezone,
  }));
}
