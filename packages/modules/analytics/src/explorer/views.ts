import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireActorTx, memberUserId } from '../access.ts';
import { ATTRIBUTION_MODELS } from '../attribution/models.ts';
import { GRANULARITIES } from '../dashboard.ts';
import { savedViews } from '../schema.ts';
import {
  comboProblem,
  DIMENSIONS,
  isAttributionMeasure,
  isMoneyMeasure,
  MEASURES,
  RANGE_PRESETS,
} from './catalog.ts';

/**
 * Saved explorer views (M6.2b): private to the member who saved them (the queries and commands
 * only ever touch the caller's own rows). A view of a money measure needs `finance:read` to save,
 * and opening it runs the money query, which checks again.
 */
export const MAX_VIEWS_PER_MEMBER = 50;

const ViewFields = z.object({
  name: z.string().trim().min(1).max(80),
  measure: z.enum(MEASURES),
  dimension: z.enum(DIMENSIONS),
  model: z.enum(ATTRIBUTION_MODELS).nullable().default(null),
  granularity: z.enum(GRANULARITIES).default('day'),
  range: z.enum(RANGE_PRESETS),
  from: z.iso.date().nullable().default(null),
  to: z.iso.date().nullable().default(null),
  eventId: z.uuid().nullable().default(null),
});

export const SavedViewDto = ViewFields.extend({ id: z.uuid(), createdAt: z.date() });
export type SavedViewDto = z.infer<typeof SavedViewDto>;

const toDto = (r: typeof savedViews.$inferSelect): SavedViewDto =>
  SavedViewDto.parse({
    id: r.id,
    name: r.name,
    measure: r.measure,
    dimension: r.dimension,
    model: r.model,
    granularity: r.granularity,
    range: r.range,
    from: r.fromDay,
    to: r.toDay,
    eventId: r.eventId,
    createdAt: r.createdAt,
  });

export const listSavedViewsQuery = tenantQuery({
  name: 'analytics.listSavedViews',
  input: z.object({}),
  output: z.array(SavedViewDto),
  entitlement: 'analytics_pro',
  permission: 'orders:read',
  handler: async ({ ctx, tx }) => {
    const rows = await tx
      .select()
      .from(savedViews)
      .where(eq(savedViews.userId, memberUserId(ctx)))
      .orderBy(asc(savedViews.name));
    return rows.map(toDto);
  },
});

export const saveViewCommand = tenantCommand({
  name: 'analytics.saveView',
  input: ViewFields,
  output: SavedViewDto,
  entitlement: 'analytics_pro',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const userId = memberUserId(ctx);
    if (comboProblem(input.measure, input.dimension))
      throw new DomainError('validation_failed', 'This measure cannot be broken down that way', {
        reason: 'touch_dimension',
      });
    if (isMoneyMeasure(input.measure)) await requireActorTx(tx, ctx, 'finance:read');
    const custom = input.range === 'custom';
    if (custom && (!input.from || !input.to))
      throw new DomainError('validation_failed', 'A custom period needs both dates', {
        reason: 'custom_needs_dates',
      });
    if (custom && input.from && input.to && input.from > input.to)
      throw new DomainError('validation_failed', 'The period ends before it starts', {
        reason: 'from_after_to',
      });
    const mine = await tx.select({ id: savedViews.id, name: savedViews.name }).from(savedViews).where(eq(savedViews.userId, userId));
    if (mine.some((v) => v.name.toLowerCase() === input.name.toLowerCase()))
      throw new DomainError('conflict', 'You already have a view with this name', { reason: 'name_taken' });
    if (mine.length >= MAX_VIEWS_PER_MEMBER)
      throw new DomainError('validation_failed', 'Too many saved views', { reason: 'too_many_views' });
    const [row] = await tx
      .insert(savedViews)
      .values({
        orgId: requireOrg(ctx),
        userId,
        name: input.name,
        measure: input.measure,
        dimension: input.dimension,
        model: isAttributionMeasure(input.measure) ? (input.model ?? 'linear') : null,
        granularity: input.granularity,
        range: input.range,
        fromDay: custom ? input.from : null,
        toDay: custom ? input.to : null,
        eventId: input.eventId,
      })
      .returning();
    if (!row) throw new Error('saveView: insert returned nothing');
    return toDto(row);
  },
  audit: (_input, out) => ({
    action: 'analytics.view_saved',
    targetType: 'analytics_view',
    targetId: out.id,
    data: { kind: out.measure },
  }),
});

export const deleteViewCommand = tenantCommand({
  name: 'analytics.deleteView',
  input: z.object({ viewId: z.uuid() }),
  output: z.object({ deleted: z.literal(true) }),
  entitlement: 'analytics_pro',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const gone = await tx
      .delete(savedViews)
      .where(and(eq(savedViews.id, input.viewId), eq(savedViews.userId, memberUserId(ctx))))
      .returning({ id: savedViews.id });
    if (gone.length === 0) throw new DomainError('not_found', 'View not found');
    return { deleted: true as const };
  },
  audit: (input) => ({
    action: 'analytics.view_deleted',
    targetType: 'analytics_view',
    targetId: input.viewId,
  }),
});
