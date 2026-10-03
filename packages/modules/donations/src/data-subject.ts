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
 * Batch 3u merge (M4.8d/e): cards the person saved for an event's giving lose the holder's name,
 * address and card description and are removed from the charity's customer on the next sweep
 * (`remove_after` now); pledge collections addressed to them lose the donor's name and address
 * (and the organizer's note); a matching sponsor who is the person loses the name, address and
 * public name (screens show "a generous sponsor"). Amounts stay with the campaign.
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
      .where(eq(savedCards.email, s.email))
      .orderBy(asc(savedCards.createdAt));
    const collections = await tx
      .select()
      .from(pledgeCollections)
      .where(eq(pledgeCollections.donorEmail, s.email))
      .orderBy(asc(pledgeCollections.createdAt));
    const matched = await tx
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
          expMonth: c.expMonth,
          expYear: c.expYear,
          consentVersion: c.consentVersion,
          consentedAt: c.consentedAt,
          removedAt: c.removedAt,
        })),
        pledgeCollections: collections.map((c) => ({
          eventId: c.eventId,
          donorName: c.donorName,
          donorEmail: c.donorEmail,
          amountMinor: c.amountMinor,
          currency: c.currency,
          status: c.status,
          dueOn: c.dueOn,
          paidAt: c.paidAt,
        })),
        matches: matched.map((m) => ({
          eventId: m.eventId,
          sponsorName: m.sponsorName,
          sponsorEmail: m.sponsorEmail,
          publicName: m.publicName,
          ratioPercent: m.ratioPercent,
          capMinor: m.capMinor,
          currency: m.currency,
          startsAt: m.startsAt,
          endsAt: m.endsAt,
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
    const cards = await tx
      .update(savedCards)
      .set({
        name: ERASED_NAME,
        email: ERASED_EMAIL,
        brand: null,
        last4: null,
        expMonth: null,
        expYear: null,
        removeAfter: now,
        updatedAt: now,
      })
      .where(eq(savedCards.email, s.email))
      .returning({ id: savedCards.id });
    const collections = await tx
      .update(pledgeCollections)
      .set({ donorName: ERASED_NAME, donorEmail: null, note: null, updatedAt: now })
      .where(eq(pledgeCollections.donorEmail, s.email))
      .returning({ id: pledgeCollections.id });
    const matched = await tx
      .update(matches)
      .set({ sponsorName: ERASED_NAME, sponsorEmail: null, publicName: null, updatedAt: now })
      .where(eq(matches.sponsorEmail, s.email))
      .returning({ id: matches.id });
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
    return {
      erased: {
        'donations.gifts': given.length - paid.length,
        'donations.saved_cards': cards.length,
        'donations.pledge_collections': collections.length,
        'donations.matches': matched.length,
      },
      held,
    };
  },
});
