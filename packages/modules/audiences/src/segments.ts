import { defineSerializer } from '@yayatoh/contracts';
import { countSegmentTx, SegmentDefinition, segmentPageTx } from '@yayatoh/crm';
import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { segments } from './schema.ts';
import { compileForOrgTx } from './scopes.ts';

export const SegmentName = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1).max(120));

/** What a preview may show about a matching person (an allowlist: no phone, no ids beyond the contact). */
export const AudienceRowDto = z.object({
  contactId: z.uuid(),
  name: z.string().nullable(),
  email: z.string(),
  events: z.int(),
  eventsAttended: z.int(),
  lastSeenAt: z.date().nullable(),
});
export type AudienceRowDto = z.infer<typeof AudienceRowDto>;

export const AudiencePreviewDto = z.object({
  count: z.int(),
  rows: z.array(AudienceRowDto),
  /** Pass as `afterId` for the next page; null on the last page. */
  nextAfter: z.uuid().nullable(),
});
export type AudiencePreviewDto = z.infer<typeof AudiencePreviewDto>;
export const audiencePreviewSerializer = defineSerializer('audiences.preview', AudiencePreviewDto);

export const SegmentDto = z.object({
  id: z.uuid(),
  name: z.string(),
  definition: SegmentDefinition,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type SegmentDto = z.infer<typeof SegmentDto>;
export const segmentSerializer = defineSerializer('audiences.segment', SegmentDto);

export const SegmentSummaryDto = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Matching people now; null when the stored definition no longer resolves (e.g. an event left). */
  count: z.int().nullable(),
  updatedAt: z.date(),
});
export type SegmentSummaryDto = z.infer<typeof SegmentSummaryDto>;

const MAX_SEGMENTS = 200;

/**
 * Count and page an audience (M3.6). `eventId` scopes it to one event: then event roles apply
 * (an event manager may preview their event's people, and nothing about other events); without
 * it, the member needs `messages:read` in the org.
 */
export const previewAudienceQuery = tenantQuery({
  name: 'audiences.preview',
  input: z.object({
    definition: SegmentDefinition,
    eventId: z.uuid().nullable().default(null),
    limit: z.int().min(1).max(100).default(10),
    afterId: z.uuid().nullable().default(null),
  }),
  output: AudiencePreviewDto,
  entitlement: 'marketing',
  permission: 'messages:read',
  handler: async ({ input, ctx, tx }) => {
    const where = await compileForOrgTx(tx, requireOrg(ctx), input.definition, input.eventId);
    const count = await countSegmentTx(tx, where);
    const page = await segmentPageTx(tx, where, { limit: input.limit + 1, afterId: input.afterId });
    const rows = page.slice(0, input.limit);
    return audiencePreviewSerializer.serialize({
      count,
      rows,
      nextAfter: page.length > input.limit ? (rows[rows.length - 1]?.contactId ?? null) : null,
    });
  },
});

async function loadSegmentTx(tx: TenantTx, segmentId: string) {
  const [row] = await tx.select().from(segments).where(eq(segments.id, segmentId));
  if (!row) throw new DomainError('not_found', 'Audience not found');
  const definition = SegmentDefinition.safeParse(row.definition);
  if (!definition.success) throw new DomainError('invalid_state', 'This audience needs to be rebuilt');
  return { ...row, definition: definition.data };
}

export const listSegmentsQuery = tenantQuery({
  name: 'audiences.listSegments',
  input: z.object({ withCounts: z.boolean().default(true) }),
  output: z.array(SegmentSummaryDto),
  entitlement: 'marketing',
  permission: 'messages:read',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx.select().from(segments).orderBy(desc(segments.updatedAt)).limit(MAX_SEGMENTS);
    const out: SegmentSummaryDto[] = [];
    for (const r of rows) {
      let count: number | null = null;
      const def = SegmentDefinition.safeParse(r.definition);
      if (input.withCounts && def.success) {
        try {
          count = await countSegmentTx(tx, await compileForOrgTx(tx, requireOrg(ctx), def.data, null));
        } catch (err) {
          if (!(err instanceof DomainError)) throw err;
        }
      }
      out.push({ id: r.id, name: r.name, count, updatedAt: r.updatedAt });
    }
    return out;
  },
});

export const getSegmentQuery = tenantQuery({
  name: 'audiences.getSegment',
  input: z.object({ segmentId: z.uuid() }),
  output: SegmentDto,
  entitlement: 'marketing',
  permission: 'messages:read',
  handler: async ({ input, tx }) => segmentSerializer.serialize(await loadSegmentTx(tx, input.segmentId)),
});

/** The stored definition of a saved audience (bulk export resolution). */
export async function segmentDefinitionTx(tx: TenantTx, segmentId: string) {
  return (await loadSegmentTx(tx, segmentId)).definition;
}

const nameTaken = (err: unknown) =>
  isUniqueViolation(err, 'segments_org_name_key')
    ? new DomainError('conflict', 'An audience with this name exists', { field: 'name' })
    : err;

/** Save an audience (new, or `segmentId` to replace one). Building audiences is for senders. */
export const saveSegmentCommand = tenantCommand({
  name: 'audiences.saveSegment',
  input: z.object({
    segmentId: z.uuid().nullable().default(null),
    name: SegmentName,
    definition: SegmentDefinition,
  }),
  output: SegmentDto,
  entitlement: 'marketing',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    // The definition must resolve for this org before it is kept.
    await compileForOrgTx(tx, orgId, input.definition, null);
    const who = ctx.actor.type === 'user' ? ctx.actor.userId : null;
    try {
      if (input.segmentId) {
        await loadSegmentTx(tx, input.segmentId).catch((err) => {
          // A stored definition that no longer parses can still be replaced.
          if (err instanceof DomainError && err.code === 'invalid_state') return null;
          throw err;
        });
        const [row] = await tx
          .update(segments)
          .set({ name: input.name, definition: input.definition, updatedBy: who, updatedAt: ctx.now })
          .where(eq(segments.id, input.segmentId))
          .returning();
        if (!row) throw new DomainError('not_found', 'Audience not found');
        return segmentSerializer.serialize({ ...row, definition: input.definition });
      }
      const [row] = await tx
        .insert(segments)
        .values({ orgId, name: input.name, definition: input.definition, createdBy: who, updatedBy: who })
        .returning();
      if (!row) throw new DomainError('internal');
      return segmentSerializer.serialize({ ...row, definition: input.definition });
    } catch (err) {
      throw nameTaken(err);
    }
  },
  audit: (input, r) => ({
    action: input.segmentId ? 'audience.update' : 'audience.create',
    targetType: 'audience',
    targetId: r?.id ?? input.segmentId,
    data: { name: input.name },
  }),
});

export const deleteSegmentCommand = tenantCommand({
  name: 'audiences.deleteSegment',
  category: 'delete',
  input: z.object({ segmentId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'marketing',
  permission: 'messages:send',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .delete(segments)
      .where(eq(segments.id, input.segmentId))
      .returning({ id: segments.id });
    if (rows.length === 0) throw new DomainError('not_found', 'Audience not found');
    return { deleted: true };
  },
  audit: (input) => ({ action: 'audience.delete', targetType: 'audience', targetId: input.segmentId }),
});
