import type { TenantTx } from '@yayatoh/db';
import { DELETE, defineDataSubjectContributor, refsOf, type SubjectErasure } from '@yayatoh/platform';
import { asc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { awards, certificates } from './schema.ts';

const mine = (s: { email: string; tickets: string[] }): SQL =>
  (s.tickets.length
    ? or(eq(certificates.holderEmail, s.email), inArray(certificates.ticketId, s.tickets))
    : eq(certificates.holderEmail, s.email)) as SQL;

/**
 * ce's part of a data-subject request (M6.9b). A person's certificates (their name, address and
 * the credits of their tickets) and the per-session awards behind them are exported, then deleted
 * on erasure (the verification code then answers "not found"). Settings and rules are the
 * organizer's.
 */
export const ceDataSubjects = defineDataSubjectContributor({
  module: 'ce',
  tables: { 'ce.certificates': DELETE, 'ce.awards': DELETE },
  async export(tx: TenantTx, s) {
    const who = { email: s.email, tickets: refsOf(s, 'ticket') };
    const certs = await tx
      .select({
        id: certificates.id,
        eventId: certificates.eventId,
        code: certificates.code,
        holderName: certificates.holderName,
        holderEmail: certificates.holderEmail,
        totalCredits: certificates.totalCredits,
        revision: certificates.revision,
        status: certificates.status,
        issuedAt: certificates.issuedAt,
      })
      .from(certificates)
      .where(mine(who))
      .orderBy(asc(certificates.issuedAt));
    const rows = certs.length
      ? await tx
          .select({
            certificateId: awards.certificateId,
            sessionId: awards.sessionId,
            inPersonMinutes: awards.inPersonMinutes,
            virtualMinutes: awards.virtualMinutes,
            minutes: awards.minutes,
            credits: awards.credits,
          })
          .from(awards)
          .where(
            inArray(
              awards.certificateId,
              certs.map((c) => c.id),
            ),
          )
      : [];
    const code = new Map(certs.map((c) => [c.id, c.code]));
    return {
      sections: {
        certificates: certs.map(({ id: _id, ...c }) => c),
        awards: rows.map(({ certificateId, ...a }) => ({
          certificate: code.get(certificateId) ?? null,
          ...a,
        })),
      },
    };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const who = { email: s.email, tickets: refsOf(s, 'ticket') };
    const ids = (await tx.select({ id: certificates.id }).from(certificates).where(mine(who))).map(
      (r) => r.id,
    );
    if (ids.length === 0) return { erased: {} };
    const a = await tx.delete(awards).where(inArray(awards.certificateId, ids)).returning({ id: awards.id });
    await tx.delete(certificates).where(inArray(certificates.id, ids));
    return { erased: { 'ce.certificates': ids.length, ...(a.length ? { 'ce.awards': a.length } : {}) } };
  },
});
