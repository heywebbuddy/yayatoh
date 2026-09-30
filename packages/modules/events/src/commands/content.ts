import { partialNoDefaults } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import { DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ANNOUNCEMENT_AUDIENCES } from '../domain/content-kinds.ts';
import { sanitizeMarkdown } from '../domain/markdown.ts';
import { SectionBody } from '../domain/sections.ts';
import { AnnouncementDto, EventSectionDto } from '../dto-content.ts';
import { events } from '../schema.ts';
import { eventAnnouncements, eventSections } from '../schema-content.ts';

export const MAX_SECTIONS_PER_EVENT = 30;

async function assertEvent(tx: TenantTx, eventId: string) {
  const [e] = await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId));
  if (!e) throw new DomainError('not_found');
}

type SectionRow = typeof eventSections.$inferSelect;
export const toSectionDto = (r: SectionRow): EventSectionDto =>
  EventSectionDto.parse({
    id: r.id,
    eventId: r.eventId,
    kind: r.kind,
    title: r.title,
    position: r.position,
    visible: r.visible,
    content: r.content,
  });

async function sectionsOf(tx: TenantTx, eventId: string): Promise<EventSectionDto[]> {
  const rows = await tx
    .select()
    .from(eventSections)
    .where(eq(eventSections.eventId, eventId))
    .orderBy(asc(eventSections.position), asc(eventSections.createdAt));
  return rows.map(toSectionDto);
}

/** Renumber 0..n-1 in the given order (positions stay dense, so moves are simple swaps). */
async function writeOrder(tx: TenantTx, ids: readonly string[], now: Date) {
  for (const [i, id] of ids.entries())
    await tx.update(eventSections).set({ position: i, updatedAt: now }).where(eq(eventSections.id, id));
}

export const eventSectionsQuery = tenantQuery({
  name: 'events.sections',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(EventSectionDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: ({ input, tx }) => sectionsOf(tx, input.eventId),
});

const Title = z.string().trim().min(1).max(120);

export const addSectionCommand = tenantCommand({
  name: 'events.addSection',
  input: z.intersection(z.object({ eventId: z.uuid(), title: Title }), SectionBody),
  output: EventSectionDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    await assertEvent(tx, input.eventId);
    const [agg] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        max: sql<number>`coalesce(max(${eventSections.position}), -1)::int`,
      })
      .from(eventSections)
      .where(eq(eventSections.eventId, input.eventId));
    if ((agg?.n ?? 0) >= MAX_SECTIONS_PER_EVENT)
      throw new DomainError('invalid_state', 'Too many sections', { reason: 'too_many_sections' });
    const [row] = await tx
      .insert(eventSections)
      .values({
        orgId,
        eventId: input.eventId,
        kind: input.kind,
        title: input.title,
        content: input.content,
        position: (agg?.max ?? -1) + 1,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return toSectionDto(row);
  },
  audit: (input, row) => ({
    action: 'event.section.add',
    targetType: 'event',
    targetId: input.eventId,
    data: { sectionId: row.id, kind: input.kind },
  }),
});

async function findSection(tx: TenantTx, eventId: string, sectionId: string) {
  const [row] = await tx
    .select()
    .from(eventSections)
    .where(and(eq(eventSections.id, sectionId), eq(eventSections.eventId, eventId)));
  if (!row) throw new DomainError('not_found');
  return row;
}

export const updateSectionCommand = tenantCommand({
  name: 'events.updateSection',
  input: z.object({
    eventId: z.uuid(),
    sectionId: z.uuid(),
    title: Title.optional(),
    /** Validated against the section's kind (a section never changes kind). */
    content: z.unknown().optional(),
    visible: z.boolean().optional(),
  }),
  output: EventSectionDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const current = await findSection(tx, input.eventId, input.sectionId);
    let content: unknown;
    if (input.content !== undefined) {
      const parsed = SectionBody.safeParse({ kind: current.kind, content: input.content });
      if (!parsed.success)
        throw new DomainError('validation_failed', 'Invalid section content', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), code: i.code })),
        });
      content = parsed.data.content;
    }
    const [row] = await tx
      .update(eventSections)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(input.visible !== undefined ? { visible: input.visible } : {}),
        updatedAt: ctx.now,
      })
      .where(eq(eventSections.id, current.id))
      .returning();
    if (!row) throw new DomainError('not_found');
    return toSectionDto(row);
  },
  audit: (input) => ({
    action: 'event.section.update',
    targetType: 'event',
    targetId: input.eventId,
    data: { sectionId: input.sectionId },
  }),
});

export const deleteSectionCommand = tenantCommand({
  name: 'events.deleteSection',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), sectionId: z.uuid() }),
  output: z.array(EventSectionDto),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await findSection(tx, input.eventId, input.sectionId);
    await tx.delete(eventSections).where(eq(eventSections.id, input.sectionId));
    const rest = await sectionsOf(tx, input.eventId);
    await writeOrder(
      tx,
      rest.map((s) => s.id),
      ctx.now,
    );
    return sectionsOf(tx, input.eventId);
  },
  audit: (input) => ({
    action: 'event.section.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { sectionId: input.sectionId },
  }),
});

/**
 * Reorder: either the full new order (drag and drop sends every id once) or one step up/down
 * (the keyboard/button alternative). Anything but a permutation of the event's sections is refused.
 */
export const reorderSectionsCommand = tenantCommand({
  name: 'events.reorderSections',
  input: z.union([
    z.object({ eventId: z.uuid(), order: z.array(z.uuid()).min(1).max(100) }),
    z.object({ eventId: z.uuid(), sectionId: z.uuid(), move: z.enum(['up', 'down']) }),
  ]),
  output: z.array(EventSectionDto),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await assertEvent(tx, input.eventId);
    const ids = (await sectionsOf(tx, input.eventId)).map((s) => s.id);
    let next: string[];
    if ('order' in input) {
      const same =
        input.order.length === ids.length &&
        new Set(input.order).size === ids.length &&
        input.order.every((id) => ids.includes(id));
      if (!same)
        throw new DomainError('conflict', 'The sections changed meanwhile; reload and try again', {
          reason: 'stale_order',
        });
      next = [...input.order];
    } else {
      const i = ids.indexOf(input.sectionId);
      if (i < 0) throw new DomainError('not_found');
      const j = input.move === 'up' ? i - 1 : i + 1;
      next = [...ids];
      if (j >= 0 && j < ids.length) [next[i], next[j]] = [next[j] as string, next[i] as string];
    }
    await writeOrder(tx, next, ctx.now);
    return sectionsOf(tx, input.eventId);
  },
  audit: (input) => ({ action: 'event.section.reorder', targetType: 'event', targetId: input.eventId }),
});

// ---------------------------------------------------------------- announcements

type AnnouncementRow = typeof eventAnnouncements.$inferSelect;
const toAnnouncement = (r: AnnouncementRow): AnnouncementDto => ({
  id: r.id,
  eventId: r.eventId,
  title: r.title,
  body: r.body,
  audience: r.audience as AnnouncementDto['audience'],
  pinned: r.pinned,
  publishedAt: r.publishedAt,
  createdAt: r.createdAt,
});

const AnnouncementFields = z.object({
  title: z.string().trim().min(2).max(160),
  body: z
    .string()
    .max(10_000)
    .transform((v) => sanitizeMarkdown(v, 5000))
    .pipe(z.string().min(1)),
  audience: z.enum(ANNOUNCEMENT_AUDIENCES).default('public'),
  pinned: z.boolean().default(false),
});

export const announcementsQuery = tenantQuery({
  name: 'events.announcements',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(AnnouncementDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) =>
    (
      await tx
        .select()
        .from(eventAnnouncements)
        .where(eq(eventAnnouncements.eventId, input.eventId))
        .orderBy(desc(eventAnnouncements.pinned), desc(eventAnnouncements.createdAt))
    ).map(toAnnouncement),
});

function emitPublished(emit: (e: DomainEvent) => void, r: AnnouncementRow) {
  // M1.10 (notifications) subscribes to send email/push to the audience; nothing is sent here.
  emit({
    type: 'event.announcement_published',
    version: 1,
    aggregateType: 'event',
    aggregateId: r.eventId,
    payload: {
      orgId: r.orgId,
      eventId: r.eventId,
      announcementId: r.id,
      audience: r.audience,
      title: r.title,
      pinned: r.pinned,
    },
  });
}

export const createAnnouncementCommand = tenantCommand({
  name: 'events.createAnnouncement',
  input: AnnouncementFields.extend({ eventId: z.uuid(), publish: z.boolean().default(false) }),
  output: AnnouncementDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await assertEvent(tx, input.eventId);
    const { publish, ...fields } = input;
    const [row] = await tx
      .insert(eventAnnouncements)
      .values({ ...fields, orgId: requireOrg(ctx), publishedAt: publish ? ctx.now : null })
      .returning();
    if (!row) throw new DomainError('internal');
    if (publish) emitPublished(emit, row);
    return toAnnouncement(row);
  },
  audit: (input, row) => ({
    action: 'event.announcement.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { announcementId: row.id, published: input.publish },
  }),
});

export const updateAnnouncementCommand = tenantCommand({
  name: 'events.updateAnnouncement',
  input: partialNoDefaults(AnnouncementFields).extend({
    eventId: z.uuid(),
    announcementId: z.uuid(),
    /** true publishes (emits once per publish), false takes it back to draft. */
    published: z.boolean().optional(),
  }),
  output: AnnouncementDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const { eventId, announcementId, published, ...fields } = input;
    const [current] = await tx
      .select()
      .from(eventAnnouncements)
      .where(and(eq(eventAnnouncements.id, announcementId), eq(eventAnnouncements.eventId, eventId)));
    if (!current) throw new DomainError('not_found');
    const publishing = published === true && current.publishedAt === null;
    const [row] = await tx
      .update(eventAnnouncements)
      .set({
        ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
        ...(publishing ? { publishedAt: ctx.now } : {}),
        ...(published === false ? { publishedAt: null } : {}),
        updatedAt: ctx.now,
      })
      .where(eq(eventAnnouncements.id, current.id))
      .returning();
    if (!row) throw new DomainError('not_found');
    if (publishing) emitPublished(emit, row);
    return toAnnouncement(row);
  },
  audit: (input) => ({
    action:
      input.published === true
        ? 'event.announcement.publish'
        : input.published === false
          ? 'event.announcement.unpublish'
          : 'event.announcement.update',
    targetType: 'event',
    targetId: input.eventId,
    data: { announcementId: input.announcementId },
  }),
});

export const deleteAnnouncementCommand = tenantCommand({
  name: 'events.deleteAnnouncement',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), announcementId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .delete(eventAnnouncements)
      .where(
        and(eq(eventAnnouncements.id, input.announcementId), eq(eventAnnouncements.eventId, input.eventId)),
      )
      .returning({ id: eventAnnouncements.id });
    if (rows.length !== 1) throw new DomainError('not_found');
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'event.announcement.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { announcementId: input.announcementId },
  }),
});
