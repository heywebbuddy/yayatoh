import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { currentFormTx } from '@yayatoh/forms';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { badgeTicketTypesTx } from '@yayatoh/ticketing';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { BadgeDesign, defaultDesign } from './domain/design.ts';
import { rescaleDesign } from './domain/layout.ts';
import { BADGE_SIZES } from './domain/sizes.ts';
import { assignments, templates, templateVersions } from './schema.ts';

export const MAX_TEMPLATES_PER_EVENT = 30;

export const TemplateDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  size: z.enum(BADGE_SIZES),
  isDefault: z.boolean(),
  version: z.int(),
  design: BadgeDesign,
  updatedAt: z.date(),
});
export type TemplateDto = z.infer<typeof TemplateDto>;

export const AssignmentDto = z.object({ ticketTypeId: z.uuid(), templateId: z.uuid() });
export const BadgeQuestionDto = z.object({ key: z.string(), label: z.string() });
export type BadgeQuestionDto = z.infer<typeof BadgeQuestionDto>;

const Name = z.string().trim().min(1).max(80);

export async function eventOfTx(tx: TenantTx, eventId: string) {
  const ev = await findEventTx(tx, eventId);
  if (!ev) throw new DomainError('not_found', 'Event not found');
  return ev;
}

/**
 * Checkout questions an organizer may put on a badge: free-text questions (short answers) that
 * are not sensitive. Anything else (choices, counts, sensitive answers) never reaches a badge.
 */
export async function badgeQuestionsTx(tx: TenantTx, eventId: string): Promise<BadgeQuestionDto[]> {
  const form = await currentFormTx(tx, {
    kind: 'checkout_questions',
    subjectType: 'event',
    subjectId: eventId,
  });
  return (form?.definition.fields ?? [])
    .filter((f) => f.type === 'short_text' && !f.sensitive)
    .map((f) => ({ key: f.key, label: f.label }));
}

type TemplateRow = typeof templates.$inferSelect;

async function withDesigns(tx: TenantTx, rows: TemplateRow[]): Promise<TemplateDto[]> {
  if (rows.length === 0) return [];
  const versions = await tx
    .select({
      templateId: templateVersions.templateId,
      version: templateVersions.version,
      design: templateVersions.design,
    })
    .from(templateVersions)
    .where(
      inArray(
        templateVersions.templateId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r) => {
    const v = versions.find((x) => x.templateId === r.id && x.version === r.currentVersion);
    if (!v) throw new DomainError('internal', 'Template version missing');
    return TemplateDto.parse({
      id: r.id,
      eventId: r.eventId,
      name: r.name,
      size: r.size,
      isDefault: r.isDefault,
      version: r.currentVersion,
      design: v.design,
      updatedAt: r.updatedAt,
    });
  });
}

export async function templatesOfTx(tx: TenantTx, eventId: string): Promise<TemplateDto[]> {
  const rows = await tx
    .select()
    .from(templates)
    .where(eq(templates.eventId, eventId))
    .orderBy(asc(templates.createdAt));
  return withDesigns(tx, rows);
}

async function templateOf(tx: TenantTx, eventId: string, templateId: string): Promise<TemplateRow> {
  const [row] = await tx
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.eventId, eventId)));
  if (!row) throw new DomainError('not_found', 'Template not found');
  return row;
}

const nameTaken = (err: unknown) => {
  if (isUniqueViolation(err, 'templates_org_event_name_key'))
    return new DomainError('conflict', 'A template with this name exists', { field: 'name' });
  return err;
};

/**
 * Validate a design against its event: ribbons only for the event's ticket types, answer
 * sources only from its non-sensitive free-text checkout questions.
 */
async function checkDesign(tx: TenantTx, eventId: string, design: BadgeDesign): Promise<void> {
  const types = new Set((await badgeTicketTypesTx(tx, eventId)).map((t) => t.id));
  for (const id of Object.keys(design.ribbons))
    if (!types.has(id))
      throw new DomainError('validation_failed', 'Unknown ticket type', { field: 'ribbons' });
  const keys = new Set((await badgeQuestionsTx(tx, eventId)).map((q) => q.key));
  for (const [field, key] of Object.entries(design.sources))
    if (key !== null && !keys.has(key))
      throw new DomainError('validation_failed', 'Not a question badges may show', {
        field: `sources.${field}`,
        reason: 'question_not_allowed',
      });
}

export const createTemplateCommand = tenantCommand({
  name: 'badges.createTemplate',
  input: z.object({
    eventId: z.uuid(),
    name: Name,
    size: z.enum(BADGE_SIZES),
    /** Start from another template of the event (its design, re-fitted to `size`). */
    copyFromId: z.uuid().nullable().default(null),
  }),
  output: TemplateDto,
  entitlement: 'badges',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOfTx(tx, input.eventId);
    const existing = await tx
      .select({ id: templates.id, isDefault: templates.isDefault })
      .from(templates)
      .where(eq(templates.eventId, input.eventId));
    if (existing.length >= MAX_TEMPLATES_PER_EVENT)
      throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
    let design = defaultDesign(input.size);
    if (input.copyFromId) {
      const [from] = await withDesigns(tx, [await templateOf(tx, input.eventId, input.copyFromId)]);
      if (from) design = rescaleDesign(from.design, input.size);
    }
    const orgId = requireOrg(ctx);
    let row: TemplateRow | undefined;
    try {
      [row] = await tx
        .insert(templates)
        .values({
          orgId,
          eventId: input.eventId,
          name: input.name,
          size: input.size,
          // The event's first template is its default.
          isDefault: !existing.some((t) => t.isDefault),
          currentVersion: 1,
        })
        .returning();
    } catch (err) {
      throw nameTaken(err);
    }
    if (!row) throw new DomainError('internal');
    await tx.insert(templateVersions).values({
      orgId,
      templateId: row.id,
      version: 1,
      design,
      createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
    });
    const [dto] = await withDesigns(tx, [row]);
    if (!dto) throw new DomainError('internal');
    return dto;
  },
  audit: (input, r) => ({
    action: 'badges.template.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { templateId: r.id, size: input.size },
  }),
});

export const saveTemplateCommand = tenantCommand({
  name: 'badges.saveTemplate',
  input: z.object({
    eventId: z.uuid(),
    templateId: z.uuid(),
    name: Name,
    design: BadgeDesign,
    /** The version the editor started from: a concurrent save is refused, not overwritten. */
    baseVersion: z.int().min(1),
  }),
  output: TemplateDto,
  entitlement: 'badges',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const row = await templateOf(tx, input.eventId, input.templateId);
    if (row.currentVersion !== input.baseVersion)
      throw new DomainError('conflict', 'Someone else saved this template', { reason: 'stale_version' });
    await checkDesign(tx, input.eventId, input.design);
    const version = row.currentVersion + 1;
    await tx.insert(templateVersions).values({
      orgId: row.orgId,
      templateId: row.id,
      version,
      design: input.design,
      createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
    });
    let updated: TemplateRow | undefined;
    try {
      [updated] = await tx
        .update(templates)
        .set({ name: input.name, size: input.design.size, currentVersion: version, updatedAt: ctx.now })
        .where(eq(templates.id, row.id))
        .returning();
    } catch (err) {
      throw nameTaken(err);
    }
    if (!updated) throw new DomainError('internal');
    const [dto] = await withDesigns(tx, [updated]);
    if (!dto) throw new DomainError('internal');
    return dto;
  },
  audit: (input, r) => ({
    action: 'badges.template.save',
    targetType: 'event',
    targetId: input.eventId,
    data: { templateId: input.templateId, version: r.version, size: r.size },
  }),
});

export const setDefaultTemplateCommand = tenantCommand({
  name: 'badges.setDefaultTemplate',
  input: z.object({ eventId: z.uuid(), templateId: z.uuid() }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'badges',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const row = await templateOf(tx, input.eventId, input.templateId);
    await tx
      .update(templates)
      .set({ isDefault: false, updatedAt: ctx.now })
      .where(and(eq(templates.eventId, input.eventId), eq(templates.isDefault, true)));
    await tx.update(templates).set({ isDefault: true, updatedAt: ctx.now }).where(eq(templates.id, row.id));
    return { ok: true };
  },
  audit: (input) => ({
    action: 'badges.template.default',
    targetType: 'event',
    targetId: input.eventId,
    data: { templateId: input.templateId },
  }),
});

export const deleteTemplateCommand = tenantCommand({
  name: 'badges.deleteTemplate',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), templateId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'badges',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const row = await templateOf(tx, input.eventId, input.templateId);
    // Its assignments go with it (cascade): those ticket types print with the default again.
    await tx.delete(templates).where(eq(templates.id, row.id));
    if (row.isDefault) {
      // Another template (the oldest) becomes the default, so badges keep printing.
      const [next] = await tx
        .select({ id: templates.id })
        .from(templates)
        .where(eq(templates.eventId, input.eventId))
        .orderBy(asc(templates.createdAt))
        .limit(1);
      if (next)
        await tx
          .update(templates)
          .set({ isDefault: true, updatedAt: ctx.now })
          .where(eq(templates.id, next.id));
    }
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'badges.template.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { templateId: input.templateId },
  }),
});

/** One template per ticket type; `templateId: null` returns the type to the event default. */
export const assignTemplateCommand = tenantCommand({
  name: 'badges.assignTemplate',
  input: z.object({ eventId: z.uuid(), ticketTypeId: z.uuid(), templateId: z.uuid().nullable() }),
  output: z.object({ ticketTypeId: z.uuid(), templateId: z.uuid().nullable() }),
  entitlement: 'badges',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const types = await badgeTicketTypesTx(tx, input.eventId);
    if (!types.some((t) => t.id === input.ticketTypeId))
      throw new DomainError('not_found', 'Ticket type not found', { field: 'ticketTypeId' });
    await tx.delete(assignments).where(eq(assignments.ticketTypeId, input.ticketTypeId));
    if (input.templateId) {
      await templateOf(tx, input.eventId, input.templateId);
      await tx.insert(assignments).values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        templateId: input.templateId,
        ticketTypeId: input.ticketTypeId,
      });
    }
    return { ticketTypeId: input.ticketTypeId, templateId: input.templateId };
  },
  audit: (input) => ({
    action: 'badges.template.assign',
    targetType: 'event',
    targetId: input.eventId,
    data: { ticketTypeId: input.ticketTypeId, templateId: input.templateId },
  }),
});

export async function assignmentsOfTx(tx: TenantTx, eventId: string) {
  const rows = await tx
    .select({ ticketTypeId: assignments.ticketTypeId, templateId: assignments.templateId })
    .from(assignments)
    .where(eq(assignments.eventId, eventId));
  return rows.flatMap((r) =>
    r.ticketTypeId ? [{ ticketTypeId: r.ticketTypeId, templateId: r.templateId }] : [],
  );
}

export const BadgesSetupDto = z.object({
  templates: z.array(TemplateDto),
  assignments: z.array(AssignmentDto),
  ticketTypes: z.array(z.object({ id: z.uuid(), name: z.string(), archived: z.boolean() })),
  questions: z.array(BadgeQuestionDto),
});
export type BadgesSetupDto = z.infer<typeof BadgesSetupDto>;

/** Everything the Badges page shows (templates, assignments, ticket types, badge questions). */
export const badgesSetupQuery = tenantQuery({
  name: 'badges.setup',
  input: z.object({ eventId: z.uuid() }),
  output: BadgesSetupDto,
  entitlement: 'badges',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    await eventOfTx(tx, input.eventId);
    return {
      templates: await templatesOfTx(tx, input.eventId),
      assignments: await assignmentsOfTx(tx, input.eventId),
      ticketTypes: await badgeTicketTypesTx(tx, input.eventId),
      questions: await badgeQuestionsTx(tx, input.eventId),
    };
  },
});
