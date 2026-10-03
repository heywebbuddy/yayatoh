import { CurrencyCode, IanaTimezone } from '@yayatoh/contracts';
import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import {
  ChecklistTitle,
  EVENT_PROFILES,
  EVENT_VISIBILITIES,
  findEventTx,
  MAX_CHECKLIST_ITEMS,
  SectionBody,
  SectionsSnapshot,
} from '@yayatoh/events';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { eventTemplates, templateEvents } from './schema.ts';
import { isStarterKey, STARTER_KEYS, STARTER_TEMPLATES } from './starters.ts';
import { EventSnapshot, TemplateDto, toTemplateDto } from './templates.ts';

/**
 * U6: the template builder. A template made from scratch starts from a profile and a few
 * settings; its ticket types, page sections and checklist are then added one at a time. Every
 * edit rewrites the stored snapshot (always the newest version) inside one tenant transaction.
 */

const TemplateName = z.string().trim().min(2).max(120);
const Description = z.string().trim().max(500).nullable().default(null);
/** 15 minutes to 14 days. */
export const DURATION_MINUTES = { min: 15, max: 14 * 24 * 60 } as const;
const DurationMinutes = z.int().min(DURATION_MINUTES.min).max(DURATION_MINUTES.max);
export const MAX_TEMPLATE_TICKET_TYPES = 30;

/** Weddings are never on the marketplace (P4-3); every other profile starts public. */
export const defaultVisibility = (profile: string) => (profile === 'wedding' ? 'private' : 'public');

const conflict = (err: unknown): never => {
  if (isUniqueViolation(err, 'event_templates_org_name_key'))
    throw new DomainError('conflict', 'A template with this name exists', { field: 'name' });
  throw err;
};

async function loadTx(tx: TenantTx, templateId: string, lock = false) {
  const q = tx.select().from(eventTemplates).where(eq(eventTemplates.id, templateId));
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw new DomainError('not_found', 'Template not found');
  return row;
}

/** Read-modify-write of a template's snapshot (row locked); archived templates are read-only. */
async function editSnapshotTx(
  tx: TenantTx,
  ctx: Ctx,
  templateId: string,
  edit: (s: EventSnapshot) => EventSnapshot,
  extra: Partial<Pick<typeof eventTemplates.$inferInsert, 'name' | 'description'>> = {},
): Promise<TemplateDto> {
  const row = await loadTx(tx, templateId, true);
  if (row.archivedAt) throw new DomainError('invalid_state', 'Template is archived', { reason: 'archived' });
  const snapshot = edit(EventSnapshot.parse(row.snapshot));
  try {
    const [next] = await tx
      .update(eventTemplates)
      .set({ ...extra, snapshot, profile: snapshot.event.profile, updatedAt: ctx.now })
      .where(eq(eventTemplates.id, templateId))
      .returning();
    if (!next) throw new DomainError('internal');
    return toTemplateDto(next);
  } catch (err) {
    return conflict(err);
  }
}

async function insertTx(
  tx: TenantTx,
  ctx: Ctx,
  v: { name: string; description: string | null; snapshot: EventSnapshot },
): Promise<TemplateDto> {
  try {
    const [row] = await tx
      .insert(eventTemplates)
      .values({
        orgId: requireOrg(ctx),
        name: v.name,
        description: v.description,
        profile: v.snapshot.event.profile,
        sourceEventId: null,
        snapshot: v.snapshot,
        createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return toTemplateDto(row);
  } catch (err) {
    return conflict(err);
  }
}

/** An empty snapshot: the profile and settings only, nothing on sale, no plan, no questions. */
function emptySnapshot(v: {
  profile: (typeof EVENT_PROFILES)[number];
  visibility: (typeof EVENT_VISIBILITIES)[number];
  timezone: string;
  currency: string;
  durationMinutes: number;
}): EventSnapshot {
  return {
    version: 2,
    event: {
      profile: v.profile,
      visibility: v.visibility,
      timezone: v.timezone,
      currency: v.currency,
      tagline: null,
      venueName: null,
      city: null,
      country: null,
      durationMs: v.durationMinutes * 60_000,
    },
    ticketTypes: [],
    questions: null,
    seating: null,
    sections: [],
    checklist: [],
  };
}

const audit = (action: string) => (input: { templateId: string }) => ({
  action,
  targetType: 'template',
  targetId: input.templateId,
});

export const createEventTemplateCommand = tenantCommand({
  name: 'templates.createTemplate',
  input: z.object({
    name: TemplateName,
    description: Description,
    profile: z.enum(EVENT_PROFILES),
    visibility: z.enum(EVENT_VISIBILITIES).optional(),
    timezone: IanaTimezone,
    currency: CurrencyCode,
    durationMinutes: DurationMinutes,
  }),
  output: TemplateDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: ({ input, ctx, tx }) =>
    insertTx(tx, ctx, {
      name: input.name,
      description: input.description,
      snapshot: emptySnapshot({ ...input, visibility: input.visibility ?? defaultVisibility(input.profile) }),
    }),
  audit: (_input, r) => ({ action: 'template.create', targetType: 'template', targetId: r?.id ?? null }),
});

/** Name, description and the settings of events made from the template (not its profile). */
export const updateTemplateCommand = tenantCommand({
  name: 'templates.updateTemplate',
  input: z.object({
    templateId: z.uuid(),
    name: TemplateName,
    description: Description,
    visibility: z.enum(EVENT_VISIBILITIES),
    timezone: IanaTimezone,
    currency: CurrencyCode,
    durationMinutes: DurationMinutes,
    tagline: z.string().trim().max(280).nullable().default(null),
    venueName: z.string().trim().max(160).nullable().default(null),
    city: z.string().trim().max(120).nullable().default(null),
  }),
  output: TemplateDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: ({ input, ctx, tx }) =>
    editSnapshotTx(
      tx,
      ctx,
      input.templateId,
      (s) => ({
        ...s,
        event: {
          ...s.event,
          visibility: input.visibility,
          timezone: input.timezone,
          currency: input.currency,
          durationMs: input.durationMinutes * 60_000,
          tagline: input.tagline || null,
          venueName: input.venueName || null,
          city: input.city || null,
        },
      }),
      { name: input.name, description: input.description },
    ),
  audit: audit('template.update'),
});

export const addTemplateTicketTypeCommand = tenantCommand({
  name: 'templates.addTicketType',
  input: z.object({
    templateId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullable().default(null),
    priceMinor: z.int().min(0).max(100_000_000),
    quantityTotal: z.int().min(1).max(1_000_000),
  }),
  output: TemplateDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: ({ input, ctx, tx }) =>
    editSnapshotTx(tx, ctx, input.templateId, (s) => {
      if (s.ticketTypes.length >= MAX_TEMPLATE_TICKET_TYPES)
        throw new DomainError('invalid_state', 'Too many ticket types', { reason: 'too_many_ticket_types' });
      const sortOrder = s.ticketTypes.reduce((m, t) => Math.max(m, t.sortOrder + 1), 0);
      return {
        ...s,
        ticketTypes: [
          ...s.ticketTypes,
          {
            key: crypto.randomUUID(),
            name: input.name,
            description: input.description || null,
            priceMinor: input.priceMinor,
            feeMode: 'pass_on',
            quantityTotal: input.quantityTotal,
            minPerOrder: 1,
            maxPerOrder: Math.min(10, input.quantityTotal),
            visibility: 'public',
            sortOrder,
            isDonation: false,
            earlyPriceMinor: null,
            earlyEndsOffsetMs: null,
            salesStartOffsetMs: null,
            salesEndOffsetMs: null,
            accessDays: [],
          },
        ],
      };
    }),
  audit: audit('template.ticket_type.add'),
});

export const removeTemplateTicketTypeCommand = tenantCommand({
  name: 'templates.removeTicketType',
  category: 'delete',
  input: z.object({ templateId: z.uuid(), key: z.string().min(1).max(100) }),
  output: TemplateDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: ({ input, ctx, tx }) =>
    editSnapshotTx(tx, ctx, input.templateId, (s) => {
      if (!s.ticketTypes.some((t) => t.key === input.key)) throw new DomainError('not_found');
      // A saved floor plan prices its seats by ticket type: keep the plan consistent.
      if (s.seating?.seats.some((seat) => seat.ticketTypeKey === input.key))
        throw new DomainError('invalid_state', 'The floor plan uses this ticket type', {
          reason: 'used_by_seating',
        });
      return { ...s, ticketTypes: s.ticketTypes.filter((t) => t.key !== input.key) };
    }),
  audit: audit('template.ticket_type.remove'),
});

export const addTemplateSectionCommand = tenantCommand({
  name: 'templates.addSection',
  input: z.intersection(
    z.object({ templateId: z.uuid(), title: z.string().trim().min(1).max(120) }),
    SectionBody,
  ),
  output: TemplateDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: ({ input, ctx, tx }) =>
    editSnapshotTx(tx, ctx, input.templateId, (s) => {
      const sections = SectionsSnapshot.safeParse([
        ...s.sections,
        { kind: input.kind, title: input.title, content: input.content, visible: true },
      ]);
      if (!sections.success)
        throw new DomainError('invalid_state', 'Too many sections', { reason: 'too_many_sections' });
      return { ...s, sections: sections.data };
    }),
  audit: audit('template.section.add'),
});

const Index = z.int().min(0).max(1000);

export const removeTemplateSectionCommand = tenantCommand({
  name: 'templates.removeSection',
  category: 'delete',
  input: z.object({ templateId: z.uuid(), index: Index }),
  output: TemplateDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: ({ input, ctx, tx }) =>
    editSnapshotTx(tx, ctx, input.templateId, (s) => {
      if (input.index >= s.sections.length) throw new DomainError('not_found');
      return { ...s, sections: s.sections.filter((_, i) => i !== input.index) };
    }),
  audit: audit('template.section.remove'),
});

/** Move a page section one place up or down (the keyboard alternative to dragging). */
export const moveTemplateSectionCommand = tenantCommand({
  name: 'templates.moveSection',
  input: z.object({ templateId: z.uuid(), index: Index, direction: z.enum(['up', 'down']) }),
  output: TemplateDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: ({ input, ctx, tx }) =>
    editSnapshotTx(tx, ctx, input.templateId, (s) => {
      const to = input.direction === 'up' ? input.index - 1 : input.index + 1;
      if (input.index >= s.sections.length) throw new DomainError('not_found');
      if (to < 0 || to >= s.sections.length) return s;
      const sections = [...s.sections];
      const [moved] = sections.splice(input.index, 1);
      if (moved) sections.splice(to, 0, moved);
      return { ...s, sections };
    }),
  audit: audit('template.section.move'),
});

export const addTemplateChecklistItemCommand = tenantCommand({
  name: 'templates.addChecklistItem',
  input: z.object({ templateId: z.uuid(), title: ChecklistTitle }),
  output: TemplateDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: ({ input, ctx, tx }) =>
    editSnapshotTx(tx, ctx, input.templateId, (s) => {
      if (s.checklist.length >= MAX_CHECKLIST_ITEMS)
        throw new DomainError('invalid_state', 'Too many checklist items', { reason: 'too_many_items' });
      return { ...s, checklist: [...s.checklist, input.title] };
    }),
  audit: audit('template.checklist.add'),
});

export const removeTemplateChecklistItemCommand = tenantCommand({
  name: 'templates.removeChecklistItem',
  category: 'delete',
  input: z.object({ templateId: z.uuid(), index: Index }),
  output: TemplateDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: ({ input, ctx, tx }) =>
    editSnapshotTx(tx, ctx, input.templateId, (s) => {
      if (input.index >= s.checklist.length) throw new DomainError('not_found');
      return { ...s, checklist: s.checklist.filter((_, i) => i !== input.index) };
    }),
  audit: audit('template.checklist.remove'),
});

/** A copy of a template under a new name (archived ones too: the copy is active). */
export const duplicateTemplateCommand = tenantCommand({
  name: 'templates.duplicateTemplate',
  input: z.object({ templateId: z.uuid(), name: TemplateName }),
  output: TemplateDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadTx(tx, input.templateId);
    return insertTx(tx, ctx, {
      name: input.name,
      description: row.description,
      snapshot: EventSnapshot.parse(row.snapshot),
    });
  },
  audit: (input, r) => ({
    action: 'template.duplicate',
    targetType: 'template',
    targetId: r?.id ?? null,
    data: { sourceTemplateId: input.templateId },
  }),
});

/** Archive (out of every picker) or restore. Events made from the template are untouched. */
export const setTemplateArchivedCommand = tenantCommand({
  name: 'templates.setArchived',
  input: z.object({ templateId: z.uuid(), archived: z.boolean() }),
  output: TemplateDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(eventTemplates)
      .set({ archivedAt: input.archived ? ctx.now : null, updatedAt: ctx.now })
      .where(eq(eventTemplates.id, input.templateId))
      .returning();
    if (!row) throw new DomainError('not_found', 'Template not found');
    return toTemplateDto(row);
  },
  audit: (input) => ({
    action: input.archived ? 'template.archive' : 'template.restore',
    targetType: 'template',
    targetId: input.templateId,
  }),
});

/**
 * Copy a read-only starter into "Your templates": its profile, visibility and length, in the
 * org's time zone and currency, ready to fill in.
 */
export const copyStarterCommand = tenantCommand({
  name: 'templates.copyStarter',
  input: z.object({
    starter: z.enum(STARTER_KEYS as [string, ...string[]]),
    name: TemplateName,
    timezone: IanaTimezone,
    currency: CurrencyCode,
  }),
  output: TemplateDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: ({ input, ctx, tx }) => {
    if (!isStarterKey(input.starter)) throw new DomainError('not_found');
    const s = STARTER_TEMPLATES[input.starter];
    return insertTx(tx, ctx, {
      name: input.name,
      description: null,
      snapshot: emptySnapshot({
        profile: s.profile,
        visibility: s.visibility,
        timezone: input.timezone,
        currency: input.currency,
        durationMinutes: s.durationHours * 60,
      }),
    });
  },
  audit: (input, r) => ({
    action: 'template.copy_starter',
    targetType: 'template',
    targetId: r?.id ?? null,
    data: { starter: input.starter },
  }),
});

const TicketLine = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceMinor: z.int(),
  quantityTotal: z.int(),
});

/** Everything the builder shows of one template, and the events made from it (newest first). */
export const TemplateDetailDto = TemplateDto.extend({
  visibility: z.enum(EVENT_VISIBILITIES),
  currency: z.string(),
  tagline: z.string().nullable(),
  venueName: z.string().nullable(),
  city: z.string().nullable(),
  ticketTypeList: z.array(TicketLine),
  sectionList: SectionsSnapshot,
  checklistItems: z.array(z.string()),
  /** Seats of a saved floor plan, by ticket type key (a priced ticket type can't be removed). */
  seatingKeys: z.array(z.string()),
  events: z.array(z.object({ id: z.uuid(), name: z.string(), slug: z.string(), status: z.string() })),
});
export type TemplateDetailDto = z.infer<typeof TemplateDetailDto>;

const MAX_LISTED_EVENTS = 20;

export const getTemplateQuery = tenantQuery({
  name: 'templates.getTemplate',
  input: z.object({ templateId: z.uuid() }),
  output: TemplateDetailDto,
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const row = await loadTx(tx, input.templateId);
    const s = EventSnapshot.parse(row.snapshot);
    const links = await tx
      .select({ eventId: templateEvents.eventId })
      .from(templateEvents)
      .where(eq(templateEvents.templateId, row.id))
      .orderBy(desc(templateEvents.createdAt))
      .limit(MAX_LISTED_EVENTS);
    const events = [];
    for (const l of links) {
      const e = await findEventTx(tx, l.eventId);
      if (e) events.push({ id: e.id, name: e.name, slug: e.slug, status: e.status });
    }
    return {
      ...toTemplateDto(row),
      visibility: s.event.visibility,
      currency: s.event.currency,
      tagline: s.event.tagline,
      venueName: s.event.venueName,
      city: s.event.city,
      ticketTypeList: s.ticketTypes.map((t) => ({
        key: t.key,
        name: t.name,
        description: t.description,
        priceMinor: t.priceMinor,
        quantityTotal: t.quantityTotal,
      })),
      sectionList: s.sections,
      checklistItems: s.checklist,
      seatingKeys: [
        ...new Set((s.seating?.seats ?? []).flatMap((x) => (x.ticketTypeKey ? [x.ticketTypeKey] : []))),
      ],
      events,
    };
  },
});
