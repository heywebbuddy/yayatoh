import type { TenantTx } from '@yayatoh/db';
import { FloorplanDoc } from '@yayatoh/floorplan';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { onChart } from './chart.ts';
import { eventLayouts, MAX_SPONSOR_NAME, tableSponsors } from './schema.ts';

/**
 * Hosted tables (M4.2b gala tables and sponsors): a table of the event plan carries a sponsor
 * name and an optional logo. The console (editor, Tables & Sponsors) always sees it; guests see
 * it on the venue map and in the seat finder only when the host published it and the plan is on
 * sale (published or locked) with its map open (`publicTableSponsorsTx`, called behind the
 * finder's own `public_map` check).
 */

/** A logo is an image of the org's own media library, as the media route serves it. */
const LOGO_PATH = /^\/media\/([0-9a-f-]{36})\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/;

export const TableSponsorDto = z.object({
  itemId: z.uuid(),
  sponsorName: z.string(),
  logoUrl: z.string().nullable(),
  published: z.boolean(),
});
export type TableSponsorDto = z.infer<typeof TableSponsorDto>;

/** A table of the event plan, for the host: its label, seats and sponsor. */
export const PlanTableDto = z.object({
  itemId: z.uuid(),
  label: z.string(),
  seats: z.int(),
  sponsor: TableSponsorDto.nullable(),
});
export type PlanTableDto = z.infer<typeof PlanTableDto>;

/** What guests may see of a hosted table: the sponsor's name and logo, nothing else. */
export const PublicTableSponsorDto = z.object({
  itemId: z.uuid(),
  sponsorName: z.string(),
  logoUrl: z.string().nullable(),
});
export type PublicTableSponsorDto = z.infer<typeof PublicTableSponsorDto>;

/** The event plan (not a date's own copy) and its tables, or null without a plan. */
async function planTablesOfTx(tx: TenantTx, eventId: string) {
  const [l] = await tx
    .select({ doc: eventLayouts.doc, status: eventLayouts.status })
    .from(eventLayouts)
    .where(onChart(eventLayouts, eventId, null));
  if (!l) return null;
  const doc = FloorplanDoc.parse(l.doc);
  const tables = doc.items.flatMap((i) =>
    i.kind === 'table' ? [{ itemId: i.id, label: i.label, seats: i.seats.length }] : [],
  );
  return { status: l.status, tables };
}

/** The event plan's tables with their sponsors, in plan order (empty without a plan). */
export const planTablesQuery = tenantQuery({
  name: 'seating.planTables',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(PlanTableDto),
  entitlement: 'seating',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const plan = await planTablesOfTx(tx, input.eventId);
    if (!plan) return [];
    const rows = await tx.select().from(tableSponsors).where(eq(tableSponsors.eventId, input.eventId));
    const by = new Map(rows.map((r) => [r.itemId, r]));
    return plan.tables.map((t) => {
      const s = by.get(t.itemId);
      return PlanTableDto.parse({
        ...t,
        sponsor: s
          ? { itemId: s.itemId, sponsorName: s.sponsorName, logoUrl: s.logoUrl, published: s.published }
          : null,
      });
    });
  },
});

export const SetTableSponsorInput = z.object({
  eventId: z.uuid(),
  itemId: z.uuid(),
  sponsorName: z.string().trim().min(1).max(MAX_SPONSOR_NAME),
  logoUrl: z.string().trim().max(300).nullable().default(null),
  published: z.boolean().default(false),
});

/** Give a table of the event plan its sponsor (or change it). */
export const setTableSponsorCommand = tenantCommand({
  name: 'seating.setTableSponsor',
  input: SetTableSponsorInput,
  output: TableSponsorDto,
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const plan = await planTablesOfTx(tx, input.eventId);
    if (!plan) throw new DomainError('not_found', 'This event has no seating plan', { reason: 'no_plan' });
    if (!plan.tables.some((t) => t.itemId === input.itemId))
      throw new DomainError('validation_failed', 'Choose a table of the plan', {
        field: 'itemId',
        reason: 'not_a_table',
      });
    if (input.logoUrl && LOGO_PATH.exec(input.logoUrl)?.[1] !== orgId)
      throw new DomainError('validation_failed', 'Choose one of your own images', {
        field: 'logoUrl',
        reason: 'foreign_logo',
      });
    const values = { sponsorName: input.sponsorName, logoUrl: input.logoUrl, published: input.published };
    const [row] = await tx
      .insert(tableSponsors)
      .values({ orgId, eventId: input.eventId, itemId: input.itemId, ...values })
      .onConflictDoUpdate({
        target: [tableSponsors.orgId, tableSponsors.eventId, tableSponsors.itemId],
        set: { ...values, updatedAt: ctx.now },
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return {
      itemId: row.itemId,
      sponsorName: row.sponsorName,
      logoUrl: row.logoUrl,
      published: row.published,
    };
  },
  audit: (input) => ({
    action: 'seating.table_sponsor.set',
    targetType: 'event',
    targetId: input.eventId,
    data: { itemId: input.itemId, published: input.published, logo: input.logoUrl !== null },
  }),
});

/** Take a table's sponsor off. */
export const removeTableSponsorCommand = tenantCommand({
  name: 'seating.removeTableSponsor',
  input: z.object({ eventId: z.uuid(), itemId: z.uuid() }),
  output: z.object({ removed: z.boolean() }),
  entitlement: 'seating',
  permission: 'seating:write',
  category: 'delete',
  handler: async ({ input, tx }) => {
    const gone = await tx
      .delete(tableSponsors)
      .where(and(eq(tableSponsors.eventId, input.eventId), eq(tableSponsors.itemId, input.itemId)))
      .returning({ id: tableSponsors.id });
    return { removed: gone.length > 0 };
  },
  audit: (input) => ({
    action: 'seating.table_sponsor.remove',
    targetType: 'event',
    targetId: input.eventId,
    data: { itemId: input.itemId },
  }),
});

/**
 * Sponsors guests may see: published by the host, on a plan that is on sale (published or
 * locked). The caller has checked the venue map is public. Keyed by table item id.
 */
export async function publicTableSponsorsTx(
  tx: TenantTx,
  eventId: string,
  itemIds?: readonly string[],
): Promise<Map<string, PublicTableSponsorDto>> {
  const [l] = await tx
    .select({ status: eventLayouts.status })
    .from(eventLayouts)
    .where(onChart(eventLayouts, eventId, null));
  if (!l || l.status === 'draft' || itemIds?.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(tableSponsors)
    .where(
      and(
        eq(tableSponsors.eventId, eventId),
        eq(tableSponsors.published, true),
        ...(itemIds ? [inArray(tableSponsors.itemId, [...itemIds])] : []),
      ),
    );
  return new Map(
    rows.map((r) => [
      r.itemId,
      PublicTableSponsorDto.parse({
        itemId: r.itemId,
        sponsorName: r.sponsorName,
        logoUrl: r.logoUrl,
      }),
    ]),
  );
}
