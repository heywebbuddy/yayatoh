import type { TenantTx } from '@yayatoh/db';
import { type DataSubject, DELETE, defineDataSubjectContributor, refsOf } from '@yayatoh/platform';
import { exhibitorNamesTx } from '@yayatoh/program';
import { asc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { leads } from './schema.ts';

/** The person's leads: captured from one of their tickets, or carrying their shared address. */
function personWhere(s: DataSubject): SQL | undefined {
  const tickets = refsOf(s, 'ticket');
  return tickets.length > 0
    ? or(inArray(leads.ticketId, tickets), eq(leads.email, s.email))
    : eq(leads.email, s.email);
}

async function leadsTx(tx: TenantTx, s: DataSubject) {
  return tx
    .select({
      id: leads.id,
      eventId: leads.eventId,
      exhibitorId: leads.exhibitorId,
      capturedAt: leads.capturedAt,
      lastScannedAt: leads.lastScannedAt,
      scans: leads.scans,
      name: leads.name,
      jobTitle: leads.jobTitle,
      company: leads.company,
      email: leads.email,
      emailWithdrawnAt: leads.emailWithdrawnAt,
      rating: leads.rating,
      qualifiers: leads.qualifiers,
      notes: leads.notes,
    })
    .from(leads)
    .where(personWhere(s))
    .orderBy(asc(leads.capturedAt));
}

/**
 * leads' part of a data-subject request (batch 3k merge, M5.6b on M6.1c). A lead is the person as
 * an exhibitor captured them (the stamped name, job title, company and shared address, and the
 * exhibitor's rating, qualifiers and notes about them): exported with the exhibitor's name, and
 * deleted on erasure (its scans go with it, `lead_scans_lead_fk` cascades). Exhibitor settings
 * hold no person.
 */
export const leadsDataSubjects = defineDataSubjectContributor({
  module: 'leads',
  tables: { 'leads.leads': DELETE },
  async export(tx, s) {
    const rows = await leadsTx(tx, s);
    const names = await exhibitorNamesTx(tx, [...new Set(rows.map((r) => r.exhibitorId))]);
    return {
      sections: {
        leads: rows.map((r) => ({
          eventId: r.eventId,
          exhibitor: names.get(r.exhibitorId) ?? null,
          capturedAt: r.capturedAt,
          lastScannedAt: r.lastScannedAt,
          scans: r.scans,
          name: r.name,
          jobTitle: r.jobTitle,
          company: r.company,
          email: r.email,
          emailWithdrawnAt: r.emailWithdrawnAt,
          rating: r.rating,
          qualifiers: r.qualifiers,
          notes: r.notes,
        })),
      },
    };
  },
  async erase(tx, s) {
    const gone = await tx.delete(leads).where(personWhere(s)).returning({ id: leads.id });
    return { erased: { 'leads.leads': gone.length } };
  },
});
