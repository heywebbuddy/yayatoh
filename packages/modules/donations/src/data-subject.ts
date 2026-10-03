import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  defineDataSubjectContributor,
  ERASED_EMAIL,
  ERASED_NAME,
  type HeldRecord,
  hold,
  REDACT,
  type SubjectErasure,
  type SubjectRefs,
} from '@yayatoh/platform';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { gifts, receipts, yearEndStatements } from './schema.ts';
import { pledgeCollections, savedCards } from './schema-collection.ts';
import { matches } from './schema-matches.ts';

/** Gifts and receipts are tax and accounting records (D11: kept 7 years). */
const HOLD_YEARS = 7;

const holdUntil = (from: Date) => {
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + HOLD_YEARS);
  return d.toISOString().slice(0, 10);
};

/** `erased+<id>@erased.invalid`: unique per row, so a year-end statement never groups two donors. */
const erasedAddress = (id: AnyPgColumn) => sql`replace(${ERASED_EMAIL}, '@', '+' || ${id}::text || '@')`;

async function giftRowsTx(tx: TenantTx, s: DataSubject) {
  return tx.select().from(gifts).where(eq(gifts.donorEmail, s.email)).orderBy(asc(gifts.createdAt));
}

/**
 * donations' part of a data-subject request (M6.1c, for M4.8a/b). The person's gifts, receipts
 * and year-end statements are tax and accounting records: they are kept under the legal hold with
 * the donor's name and address replaced (a per-row erased address, so statements never merge two
 * erased donors), the employer and the tribute (names of other people) removed and the gift shown
 * anonymously on donor walls. Each kept row is listed in the receipt. Campaigns, levels and the
 * charity profile are the organizer's own.
 *
 * Batch 3j merge (M4.8e/f): cards the person saved (by their address) are exported with their
 * brand and last four only, and on erasure removed (never charged again; a scheduled pledge falls
 * back to its invoice) with the name, address and card details cleared; pledge collections lose
 * the donor's name and address (amounts and states stay with the pledge); a match they sponsored
 * loses the sponsor's name and address (its public name is what the sponsor chose to show).
 */
export const donationsDataSubjects = defineDataSubjectContributor({
  module: 'donations',
  tables: {
    'donations.gifts': hold('tax_accounting'),
    'donations.receipts': hold('tax_accounting'),
    'donations.year_end_statements': hold('tax_accounting'),
    'donations.saved_cards': REDACT,
    'donations.pledge_collections': REDACT,
    'donations.matches': REDACT,
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const rows = await giftRowsTx(tx, s);
    if (rows.length === 0) return {};
    return {
      gift: rows.map((g) => g.id),
      order: rows.map((g) => g.orderId),
      name: rows.map((g) => g.donorName),
    };
  },
  async export(tx, s) {
    const given = await giftRowsTx(tx, s);
    const issued = await tx
      .select()
      .from(receipts)
      .where(eq(receipts.donorEmail, s.email))
      .orderBy(asc(receipts.number));
    const statements = await tx
      .select()
      .from(yearEndStatements)
      .where(eq(yearEndStatements.donorEmail, s.email))
      .orderBy(asc(yearEndStatements.taxYear));
    const cards = await tx
      .select()
      .from(savedCards)
      .where(eq(sql`lower(${savedCards.email})`, s.email))
      .orderBy(asc(savedCards.createdAt));
    const collections = await tx
      .select()
      .from(pledgeCollections)
      .where(eq(sql`lower(${pledgeCollections.donorEmail})`, s.email))
      .orderBy(asc(pledgeCollections.createdAt));
    const sponsored = await tx
      .select()
      .from(matches)
      .where(eq(matches.sponsorEmail, s.email))
      .orderBy(asc(matches.createdAt));
    return {
      sections: {
        savedCards: cards.map((c) => ({
          eventId: c.eventId,
          name: c.name,
          email: c.email,
          status: c.status,
          brand: c.brand,
          last4: c.last4,
          consentVersion: c.consentVersion,
          consentedAt: c.consentedAt,
          createdAt: c.createdAt,
        })),
        pledgeCollections: collections.map((c) => ({
          eventId: c.eventId,
          donorName: c.donorName,
          donorEmail: c.donorEmail,
          amountMinor: c.amountMinor,
          currency: c.currency,
          status: c.status,
          paidAt: c.paidAt,
          createdAt: c.createdAt,
        })),
        sponsoredMatches: sponsored.map((m) => ({
          eventId: m.eventId,
          sponsorName: m.sponsorName,
          sponsorEmail: m.sponsorEmail,
          publicName: m.publicName,
          ratioPercent: m.ratioPercent,
          capMinor: m.capMinor,
          currency: m.currency,
          status: m.status,
          matchedMinor: m.matchedMinor,
        })),
        gifts: given.map((g) => ({
          eventId: g.eventId,
          orderId: g.orderId,
          status: g.status,
          amountMinor: g.amountMinor,
          feeCoverMinor: g.feeCoverMinor,
          currency: g.currency,
          donorName: g.donorName,
          donorEmail: g.donorEmail,
          displayAs: g.displayAs,
          employer: g.employer,
          tributeKind: g.tributeKind,
          tributeName: g.tributeName,
          tributeRecipient: g.tributeRecipient,
          tributeNote: g.tributeNote,
          paidAt: g.paidAt,
          createdAt: g.createdAt,
        })),
        receipts: issued.map((r) => ({
          number: r.number,
          kind: r.kind,
          deductible: r.deductible,
          donorName: r.donorName,
          donorEmail: r.donorEmail,
          amountMinor: r.amountMinor,
          deductibleMinor: r.deductibleMinor,
          currency: r.currency,
          charityName: r.charityName,
          paidAt: r.paidAt,
          taxYear: r.taxYear,
        })),
        yearEndStatements: statements.map((y) => ({
          taxYear: y.taxYear,
          donorName: y.donorName,
          donorEmail: y.donorEmail,
          receiptCount: y.receiptCount,
          amountMinor: y.amountMinor,
          deductibleMinor: y.deductibleMinor,
          currency: y.currency,
          charityName: y.charityName,
        })),
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const now = ctx.now;
    const ids = (await giftRowsTx(tx, s)).map((g) => g.id);
    const given = ids.length
      ? await tx
          .update(gifts)
          .set({
            donorName: ERASED_NAME,
            donorEmail: ERASED_EMAIL,
            displayAs: 'anonymous',
            employer: null,
            tributeKind: null,
            tributeName: null,
            tributeRecipient: null,
            tributeNote: null,
            updatedAt: now,
          })
          .where(inArray(gifts.id, ids))
          .returning({ id: gifts.id, status: gifts.status, paidAt: gifts.paidAt, createdAt: gifts.createdAt })
      : [];
    const issued = await tx
      .update(receipts)
      .set({ donorName: ERASED_NAME, donorEmail: erasedAddress(receipts.id), updatedAt: now })
      .where(eq(receipts.donorEmail, s.email))
      .returning({ id: receipts.id, number: receipts.number, paidAt: receipts.paidAt });
    const statements = await tx
      .update(yearEndStatements)
      .set({ donorName: ERASED_NAME, donorEmail: erasedAddress(yearEndStatements.id), updatedAt: now })
      .where(eq(yearEndStatements.donorEmail, s.email))
      .returning({
        id: yearEndStatements.id,
        taxYear: yearEndStatements.taxYear,
        createdAt: yearEndStatements.createdAt,
      });
    const paid = given.filter((g) => g.status === 'paid');
    const held: HeldRecord[] = [
      ...paid.map((g) => ({
        table: 'donations.gifts',
        id: g.id,
        ref: g.status,
        basis: 'tax_accounting' as const,
        until: holdUntil(g.paidAt ?? g.createdAt),
      })),
      ...issued.map((r) => ({
        table: 'donations.receipts',
        id: r.id,
        ref: `#${r.number}`,
        basis: 'tax_accounting' as const,
        until: holdUntil(r.paidAt),
      })),
      ...statements.map((y) => ({
        table: 'donations.year_end_statements',
        id: y.id,
        ref: String(y.taxYear),
        basis: 'tax_accounting' as const,
        until: holdUntil(y.createdAt),
      })),
    ];
    const cards = await tx
      .update(savedCards)
      .set({
        name: ERASED_NAME,
        email: erasedAddress(savedCards.id),
        brand: null,
        last4: null,
        status: 'removed',
        removedAt: sql`coalesce(${savedCards.removedAt}, ${now.toISOString()}::timestamptz)`,
      })
      .where(eq(sql`lower(${savedCards.email})`, s.email))
      .returning({ id: savedCards.id });
    const collections = await tx
      .update(pledgeCollections)
      .set({ donorName: ERASED_NAME, donorEmail: null })
      .where(eq(sql`lower(${pledgeCollections.donorEmail})`, s.email))
      .returning({ id: pledgeCollections.id });
    const sponsored = await tx
      .update(matches)
      .set({ sponsorName: ERASED_NAME, sponsorEmail: null })
      .where(eq(matches.sponsorEmail, s.email))
      .returning({ id: matches.id });
    return {
      erased: {
        'donations.gifts': given.length - paid.length,
        'donations.saved_cards': cards.length,
        'donations.pledge_collections': collections.length,
        'donations.matches': sponsored.length,
      },
      held,
    };
  },
});
