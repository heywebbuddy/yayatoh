import type { TenantTx } from '@yayatoh/db';
import { desc, inArray } from 'drizzle-orm';
import { registrants } from './schema.ts';

/**
 * M5.6b lead capture: what a registrant said about themselves (company and job title), by the
 * ticket their registration issued. Nothing else of the registrant leaves this function.
 */
export async function registrantProfilesByTicketTx(
  tx: TenantTx,
  ticketIds: readonly string[],
): Promise<Map<string, { name: string; email: string; company: string | null; jobTitle: string | null }>> {
  if (ticketIds.length === 0) return new Map();
  const rows = await tx
    .select({
      ticketId: registrants.ticketId,
      name: registrants.name,
      email: registrants.email,
      company: registrants.company,
      jobTitle: registrants.jobTitle,
    })
    .from(registrants)
    .where(inArray(registrants.ticketId, [...ticketIds]))
    .orderBy(desc(registrants.createdAt));
  const out = new Map<
    string,
    { name: string; email: string; company: string | null; jobTitle: string | null }
  >();
  for (const r of rows)
    if (r.ticketId && !out.has(r.ticketId))
      out.set(r.ticketId, { name: r.name, email: r.email, company: r.company, jobTitle: r.jobTitle });
  return out;
}
