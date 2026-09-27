import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import {
  EventDto,
  EventSettingsSnapshot,
  eventSettingsTx,
  insertEventCopyTx,
  joinSeriesTx,
  seriesOfEventTx,
} from '@yayatoh/events';
import { currentFormTx, FormDefinition, publishFormTx } from '@yayatoh/forms';
import { type Ctx, DomainError, requireOrg, utcToZonedInput } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { instantiateSeatingTx, SeatingSnapshot, seatingSnapshotTx } from '@yayatoh/seating';
import { instantiateTicketTypesTx, TicketTypesSnapshot, ticketTypesSnapshotTx } from '@yayatoh/ticketing';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { eventTemplates } from './schema.ts';

/** Version 1 of what a template holds (and what "duplicate" copies). */
export const EventSnapshot = z.object({
  version: z.literal(1),
  event: EventSettingsSnapshot,
  ticketTypes: TicketTypesSnapshot,
  questions: FormDefinition.nullable(),
  seating: SeatingSnapshot,
});
export type EventSnapshot = z.infer<typeof EventSnapshot>;

const QUESTIONS = { kind: 'checkout_questions', subjectType: 'event' } as const;
const localDay = (at: Date, tz: string) => utcToZonedInput(at, tz).slice(0, 10);

/** Everything a copy takes from an event (never orders, tickets, attendees, check-ins, payouts). */
async function snapshotTx(tx: TenantTx, eventId: string) {
  const { name, startsAt, settings } = await eventSettingsTx(tx, eventId);
  const form = await currentFormTx(tx, { ...QUESTIONS, subjectId: eventId });
  const snapshot: EventSnapshot = {
    version: 1,
    event: settings,
    ticketTypes: await ticketTypesSnapshotTx(tx, eventId, startsAt, localDay(startsAt, settings.timezone)),
    questions: form && form.definition.fields.length > 0 ? form.definition : null,
    seating: await seatingSnapshotTx(tx, eventId),
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
  createdAt: z.date(),
});
export type TemplateDto = z.infer<typeof TemplateDto>;

const toDto = (r: typeof eventTemplates.$inferSelect): TemplateDto => {
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
      return toDto(row);
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
    const event = await instantiateTx(tx, ctx, {
      name: input.name,
      startsAt: input.startsAt,
      snapshot: EventSnapshot.parse(t.snapshot),
    });
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

export const listTemplatesQuery = tenantQuery({
  name: 'templates.listTemplates',
  input: z.object({}),
  output: z.array(TemplateDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ tx }) =>
    (await tx.select().from(eventTemplates).orderBy(asc(eventTemplates.name))).map(toDto),
});
