import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import {
  checklistTitlesTx,
  EventDto,
  EventSettingsSnapshot,
  eventSettingsTx,
  insertChecklistItemsTx,
  insertEventCopyTx,
  insertSectionsTx,
  joinSeriesTx,
  MAX_CHECKLIST_ITEMS,
  SectionsSnapshot,
  sectionsSnapshotTx,
  seriesOfEventTx,
} from '@yayatoh/events';
import { currentFormTx, FormDefinition, publishFormTx } from '@yayatoh/forms';
import { type Ctx, DomainError, requireOrg, utcToZonedInput } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { instantiateSeatingTx, SeatingSnapshot, seatingSnapshotTx } from '@yayatoh/seating';
import { instantiateTicketTypesTx, TicketTypesSnapshot, ticketTypesSnapshotTx } from '@yayatoh/ticketing';
import { asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { eventTemplates, templateEvents } from './schema.ts';

/** Version 1 of what a template holds (M1.4b). */
const EventSnapshotV1 = z.object({
  version: z.literal(1),
  event: EventSettingsSnapshot,
  ticketTypes: TicketTypesSnapshot,
  questions: FormDefinition.nullable(),
  seating: SeatingSnapshot,
});

/**
 * Version 2 (U6): also the event page's sections and the organizer's checklist titles, so a
 * template made from scratch carries its content. Version 1 rows read as v2 with neither.
 */
export const EventSnapshotV2 = EventSnapshotV1.extend({
  version: z.literal(2),
  sections: SectionsSnapshot,
  checklist: z.array(z.string().trim().min(1).max(200)).max(MAX_CHECKLIST_ITEMS),
});
export type EventSnapshot = z.infer<typeof EventSnapshotV2>;

/** What a template holds (and what "duplicate" copies), normalized to the newest version. */
export const EventSnapshot: z.ZodType<EventSnapshot, unknown> = z.union([
  EventSnapshotV2,
  EventSnapshotV1.transform((v1): EventSnapshot => ({ ...v1, version: 2, sections: [], checklist: [] })),
]);

const QUESTIONS = { kind: 'checkout_questions', subjectType: 'event' } as const;
const localDay = (at: Date, tz: string) => utcToZonedInput(at, tz).slice(0, 10);

/** Everything a copy takes from an event (never orders, tickets, attendees, check-ins, payouts). */
async function snapshotTx(tx: TenantTx, eventId: string) {
  const { name, startsAt, settings } = await eventSettingsTx(tx, eventId);
  const form = await currentFormTx(tx, { ...QUESTIONS, subjectId: eventId });
  const snapshot: EventSnapshot = {
    version: 2,
    event: settings,
    ticketTypes: await ticketTypesSnapshotTx(tx, eventId, startsAt, localDay(startsAt, settings.timezone)),
    questions: form && form.definition.fields.length > 0 ? form.definition : null,
    seating: await seatingSnapshotTx(tx, eventId),
    sections: await sectionsSnapshotTx(tx, eventId),
    checklist: await checklistTitlesTx(tx, eventId),
  };
  return { name, startsAt, snapshot };
}

/** A new draft event from a snapshot, starting at `startsAt`. */
async function instantiateTx(
  tx: TenantTx,
  ctx: Ctx,
  input: { name: string; startsAt: Date; snapshot: EventSnapshot },
): Promise<EventDto> {
  const s = input.snapshot;
  const event = await insertEventCopyTx(tx, ctx, {
    name: input.name,
    startsAt: input.startsAt,
    settings: s.event,
  });
  const typeIds = await instantiateTicketTypesTx(tx, ctx, {
    eventId: event.id,
    currency: event.currency,
    anchor: event.startsAt,
    anchorDay: localDay(event.startsAt, event.timezone),
    snapshot: s.ticketTypes,
  });
  if (s.questions) await publishFormTx(tx, ctx, { ...QUESTIONS, subjectId: event.id }, s.questions);
  await instantiateSeatingTx(tx, ctx, { eventId: event.id, snapshot: s.seating, ticketTypeIds: typeIds });
  await insertSectionsTx(tx, ctx, event.id, s.sections);
  await insertChecklistItemsTx(tx, ctx, event.id, s.checklist);
  return event;
}

const Name = z.string().trim().min(2).max(160);

/** The same `event.created@1` a new event emits, plus where the copy came from. */
const created = (orgId: string, event: EventDto, from: Record<string, string>) => ({
  type: 'event.created',
  version: 1,
  aggregateType: 'event',
  aggregateId: event.id,
  payload: { orgId, eventId: event.id, slug: event.slug, profile: event.profile, ...from },
});

/**
 * Duplicate an event: a new draft with a new slug, the same settings, ticket types, questions and
 * seating plan, and the same series. Orders, tickets, attendees, check-ins and payouts stay behind.
 */
export const duplicateEventCommand = tenantCommand({
  name: 'templates.duplicateEvent',
  input: z.object({ eventId: z.uuid(), name: Name, startsAt: z.coerce.date().optional() }),
  output: EventDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const source = await snapshotTx(tx, input.eventId);
    const event = await instantiateTx(tx, ctx, {
      name: input.name,
      startsAt: input.startsAt ?? source.startsAt,
      snapshot: source.snapshot,
    });
    const seriesId = await seriesOfEventTx(tx, input.eventId);
    if (seriesId) await joinSeriesTx(tx, orgId, event.id, seriesId);
    emit(created(orgId, event, { duplicatedFrom: input.eventId }));
    return event;
  },
  audit: (input, event) => ({
    action: 'event.duplicate',
    targetType: 'event',
    targetId: event?.id ?? null,
    data: { sourceEventId: input.eventId },
  }),
});

export const TemplateDto = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  profile: z.string(),
  /** Times of events made from it are entered in this zone. */
  timezone: z.string(),
  ticketTypes: z.int(),
  questions: z.int(),
  seats: z.int(),
  /** U6: page sections and checklist items the template carries. */
  sections: z.int(),
  checklist: z.int(),
  /** U6: minutes from start to end of events made from it. */
  durationMinutes: z.int(),
  /** U6: `event` when saved from an event, `scratch` when built in the template builder. */
  origin: z.enum(['event', 'scratch']),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type TemplateDto = z.infer<typeof TemplateDto>;

export const toTemplateDto = (r: typeof eventTemplates.$inferSelect): TemplateDto => {
  const s = EventSnapshot.parse(r.snapshot);
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    profile: r.profile,
    timezone: s.event.timezone,
    ticketTypes: s.ticketTypes.length,
    questions: s.questions?.fields.length ?? 0,
    seats: s.seating?.seats.length ?? 0,
    sections: s.sections.length,
    checklist: s.checklist.length,
    durationMinutes: Math.round(s.event.durationMs / 60_000),
    origin: r.sourceEventId ? 'event' : 'scratch',
    archivedAt: r.archivedAt,
    createdAt: r.createdAt,
  };
};

export const saveTemplateCommand = tenantCommand({
  name: 'templates.saveTemplate',
  input: z.object({
    eventId: z.uuid(),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).nullable().default(null),
  }),
  output: TemplateDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const { snapshot } = await snapshotTx(tx, input.eventId);
    try {
      const [row] = await tx
        .insert(eventTemplates)
        .values({
          orgId: requireOrg(ctx),
          name: input.name,
          description: input.description,
          profile: snapshot.event.profile,
          sourceEventId: input.eventId,
          snapshot,
          createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        })
        .returning();
      if (!row) throw new DomainError('internal');
      return toTemplateDto(row);
    } catch (err) {
      if (isUniqueViolation(err, 'event_templates_org_name_key'))
        throw new DomainError('conflict', 'A template with this name exists', { field: 'name' });
      throw err;
    }
  },
  audit: (input, r) => ({
    action: 'template.save',
    targetType: 'template',
    targetId: r?.id ?? null,
    data: { sourceEventId: input.eventId },
  }),
});

export const createFromTemplateCommand = tenantCommand({
  name: 'templates.createFromTemplate',
  input: z.object({ templateId: z.uuid(), name: Name, startsAt: z.coerce.date() }),
  output: EventDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const [t] = await tx.select().from(eventTemplates).where(eq(eventTemplates.id, input.templateId));
    if (!t) throw new DomainError('not_found', 'Template not found');
    // U6: an archived template is out of every picker; restore it to use it again.
    if (t.archivedAt) throw new DomainError('invalid_state', 'Template is archived', { reason: 'archived' });
    const event = await instantiateTx(tx, ctx, {
      name: input.name,
      startsAt: input.startsAt,
      snapshot: EventSnapshot.parse(t.snapshot),
    });
    await tx.insert(templateEvents).values({ orgId: requireOrg(ctx), templateId: t.id, eventId: event.id });
    emit(created(requireOrg(ctx), event, { templateId: t.id }));
    return event;
  },
  audit: (input, event) => ({
    action: 'event.create_from_template',
    targetType: 'event',
    targetId: event?.id ?? null,
    data: { templateId: input.templateId },
  }),
});

export const deleteTemplateCommand = tenantCommand({
  name: 'templates.deleteTemplate',
  category: 'delete',
  input: z.object({ templateId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .delete(eventTemplates)
      .where(eq(eventTemplates.id, input.templateId))
      .returning({ id: eventTemplates.id });
    if (rows.length === 0) throw new DomainError('not_found', 'Template not found');
    return { deleted: true };
  },
  audit: (input) => ({ action: 'template.delete', targetType: 'template', targetId: input.templateId }),
});

/** The org's templates by name: the active ones (every picker), or the archived ones. */
export const listTemplatesQuery = tenantQuery({
  name: 'templates.listTemplates',
  input: z.object({ archived: z.boolean().default(false) }),
  output: z.array(TemplateDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) =>
    (
      await tx
        .select()
        .from(eventTemplates)
        .where(input.archived ? isNotNull(eventTemplates.archivedAt) : isNull(eventTemplates.archivedAt))
        .orderBy(asc(eventTemplates.name))
    ).map(toTemplateDto),
});
