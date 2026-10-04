import { tenantQuery } from '@yayatoh/platform';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordLinks } from './schema.ts';

/**
 * How many records a connection has linked, per object (M6.5b): what a sync has put in step so
 * far ("Contacts 120, Campaigns 4, …"). Counts only: no ids, no values.
 */
export const linkedCountsQuery = tenantQuery({
  name: 'integrations.linkedCounts',
  input: z.object({ connectionId: z.uuid() }),
  output: z.object({
    objects: z.array(z.object({ objectType: z.string().max(63), count: z.int() })).max(50),
  }),
  entitlement: 'integrations',
  permission: 'integrations:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select({ objectType: recordLinks.objectType, count: sql<number>`count(*)::int` })
      .from(recordLinks)
      .where(eq(recordLinks.connectionId, input.connectionId))
      .groupBy(recordLinks.objectType);
    return { objects: rows.map((r) => ({ objectType: r.objectType, count: Number(r.count) })) };
  },
});
