import {
  DELETE,
  defineDataSubjectContributor,
  type SubjectErasure,
  type SubjectExport,
  type SubjectRefs,
} from '@yayatoh/platform';
import { asc, eq, sql } from 'drizzle-orm';
import { quoteRequests, venues } from './schema.ts';

/** The stored address, matched like the normalized one (it is kept as typed). */
const byEmail = (email: string) => sql`lower(btrim(${quoteRequests.email})) = ${email}`;

/**
 * venues' part of a data-subject request (M6.1c). "Request a quote" enquiries the person sent
 * about the org's venues are deleted (name, address, phone and message are theirs). Venues are
 * public places, not people.
 */
export const venuesDataSubjects = defineDataSubjectContributor({
  module: 'venues',
  tables: {
    'venues.quote_requests': DELETE,
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const rows = await tx
      .select({ name: quoteRequests.name, phone: quoteRequests.phone })
      .from(quoteRequests)
      .where(byEmail(s.email));
    if (rows.length === 0) return {};
    return {
      name: rows.map((r) => r.name),
      phone: rows.flatMap((r) => (r.phone ? [r.phone] : [])),
    };
  },
  async export(tx, s): Promise<SubjectExport> {
    const rows = await tx
      .select({
        venue: venues.name,
        name: quoteRequests.name,
        email: quoteRequests.email,
        phone: quoteRequests.phone,
        eventDate: quoteRequests.eventDate,
        guests: quoteRequests.guests,
        message: quoteRequests.message,
        status: quoteRequests.status,
        sentAt: quoteRequests.createdAt,
      })
      .from(quoteRequests)
      .innerJoin(venues, eq(venues.id, quoteRequests.venueId))
      .where(byEmail(s.email))
      .orderBy(asc(quoteRequests.createdAt));
    return { sections: { quoteRequests: rows } };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const gone = await tx.delete(quoteRequests).where(byEmail(s.email)).returning({ id: quoteRequests.id });
    return { erased: { 'venues.quote_requests': gone.length } };
  },
});
