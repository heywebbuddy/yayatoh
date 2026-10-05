import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  ERASED_EMAIL,
  ERASED_NAME,
  notSubject,
  REDACT,
  type SubjectErasure,
  type SubjectRefs,
} from '@yayatoh/platform';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { registrants, typeMembers } from './schema.ts';

/** The person's registrant records (M5.1c): their own applications, by address. */
async function registrantRowsTx(tx: TenantTx, s: DataSubject) {
  return tx
    .select()
    .from(registrants)
    .where(eq(registrants.email, s.email))
    .orderBy(asc(registrants.createdAt));
}

/**
 * registration's part of a data-subject request (M6.1c). Registration types and admission items
 * are the organizer's setup (an access code is handed to the people who may use it); capacity
 * claims count an order's tickets (ids and numbers only). The person's registrant records (M5.1c)
 * are redacted in place: tickets, orders, session places and group hosts point at them, so the
 * rows stay with the name replaced, a per-record erased address (one live application per address
 * and type) and their answers and the decision reason removed. Their address goes from every
 * type's member list.
 */
export const registrationDataSubjects = defineDataSubjectContributor({
  module: 'registration',
  tables: {
    'registration.registration_types': notSubject(
      "the organizer's registration types; the access code is shared with whoever may use it",
    ),
    'registration.registrants': REDACT,
    'registration.type_members': DELETE,
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const rows = await registrantRowsTx(tx, s);
    if (rows.length === 0) return {};
    return { registrant: rows.map((r) => r.id), name: rows.map((r) => r.name) };
  },
  async export(tx, s) {
    const rows = await registrantRowsTx(tx, s);
    const members = await tx
      .select({ eventId: typeMembers.eventId, source: typeMembers.source, addedAt: typeMembers.createdAt })
      .from(typeMembers)
      .where(eq(typeMembers.email, s.email));
    return {
      sections: {
        registrants: rows.map((r) => ({
          eventId: r.eventId,
          status: r.status,
          name: r.name,
          email: r.email,
          company: r.company,
          jobTitle: r.jobTitle,
          message: r.message,
          locale: r.locale,
          decisionReason: r.decisionReason,
          decidedAt: r.decidedAt,
          confirmedAt: r.confirmedAt,
          createdAt: r.createdAt,
        })),
        memberLists: members,
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const ids = (await registrantRowsTx(tx, s)).map((r) => r.id);
    const redacted = ids.length
      ? await tx
          .update(registrants)
          .set({
            name: ERASED_NAME,
            // `erased+<id>@erased.invalid`: unique per record (one live application per address and type).
            email: sql`replace(${ERASED_EMAIL}, '@', '+' || ${registrants.id}::text || '@')`,
            company: null,
            jobTitle: null,
            message: null,
            decisionReason: null,
            updatedAt: ctx.now,
          })
          .where(inArray(registrants.id, ids))
          .returning({ id: registrants.id })
      : [];
    const members = await tx
      .delete(typeMembers)
      .where(eq(typeMembers.email, s.email))
      .returning({ id: typeMembers.id });
    return {
      erased: {
        'registration.registrants': redacted.length,
        'registration.type_members': members.length,
      },
    };
  },
});
