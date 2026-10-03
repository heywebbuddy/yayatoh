import { type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { receiptOrderFactsTx } from '@yayatoh/orders';
import {
  catchUpSubscriber,
  defineSubscriber,
  type Notifier,
  signLinkToken,
  tenantCommand,
  tenantQuery,
  verifyLinkToken,
} from '@yayatoh/platform';
import { organizationDefaultsTx, organizationNameTx } from '@yayatoh/tenancy';
import { ticketTypePricesTx } from '@yayatoh/ticketing';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { charityProfileTx } from './charity.ts';
import {
  CHARITY_STATUSES,
  type CharityStatus,
  giftReceiptAmounts,
  isDeductibleReceipt,
  RECEIPT_KINDS,
  type ReceiptAmounts,
  statementTotals,
  statementYearDue,
  taxYearOf,
  ticketReceiptAmounts,
} from './domain/receipts.ts';
import { fairValuesOfEventTx, fairValuesOfTypesTx } from './fair-value.ts';
import { RECEIPT_COPY_VERSION } from './legal/receipt-copy.ts';
import {
  type ReceiptDocInput,
  receiptEmailBody,
  type StatementDocInput,
  statementEmailBody,
} from './receipt-document.ts';
import { receiptSequences, receipts, yearEndStatements } from './schema.ts';

type ReceiptRow = typeof receipts.$inferSelect;
type StatementRow = typeof yearEndStatements.$inferSelect;

const RECEIPT_PURPOSE = 'donations.receipt';
const STATEMENT_PURPOSE = 'donations.statement';

/** The donor's receipt link token (HMAC-signed id; the link goes only to the donor's email). */
export const receiptToken = (receiptId: string) => signLinkToken(RECEIPT_PURPOSE, receiptId);
export const statementToken = (statementId: string) => signLinkToken(STATEMENT_PURPOSE, statementId);

// The locale came from the donor's request; only a well-formed tag goes into a URL.
const localePrefix = (locale: string) =>
  locale !== 'en' && /^[a-z]{2}(-[A-Z]{2})?$/.test(locale) ? `/${locale}` : '';

/** The donor's links (org id in the path: the tenant comes from the route, never a header). */
export const receiptUrl = (appOrigin: string, r: { orgId: string; id: string; locale: string }) =>
  `${appOrigin}${localePrefix(r.locale)}/receipts/${r.orgId}/${receiptToken(r.id)}`;
export const statementUrl = (appOrigin: string, s: { orgId: string; id: string; locale: string }) =>
  `${appOrigin}${localePrefix(s.locale)}/statements/${s.orgId}/${statementToken(s.id)}`;

/** Take the org's next receipt number (the counter row stays locked until the transaction ends). */
async function nextNumberTx(tx: TenantTx, orgId: string, now: Date): Promise<number> {
  const [row] = await tx
    .insert(receiptSequences)
    .values({ orgId, lastNumber: 1 })
    .onConflictDoUpdate({
      target: receiptSequences.orgId,
      set: { lastNumber: sql`${receiptSequences.lastNumber} + 1`, updatedAt: now },
    })
    .returning({ n: receiptSequences.lastNumber });
  if (!row) throw new DomainError('internal');
  return row.n;
}

/**
 * Issue the receipt of a paid order (M4.8b, P4-11), once: a gift order's, or a ticket order's when
 * one of its ticket types has a fair-market value. Tax-deductible only for a verified charity, on
 * the charity's own connected account, in USD; otherwise a plain "not tax-deductible" receipt.
 * Returns `{ receipt, issued }` (`issued` false when it already existed), or null when the order
 * gets no receipt (not paid, or a ticket order with no fair-market value at all).
 */
export async function issueReceiptTx(
  tx: TenantTx,
  orgId: string,
  orderId: string,
  now: Date,
): Promise<{ receipt: ReceiptRow; issued: boolean } | null> {
  const [existing] = await tx.select().from(receipts).where(eq(receipts.orderId, orderId));
  if (existing) return { receipt: existing, issued: false };
  const o = await receiptOrderFactsTx(tx, orderId);
  if (!o || !['paid', 'partially_refunded'].includes(o.status)) return null;
  let amounts: ReceiptAmounts;
  if (o.gift) amounts = giftReceiptAmounts(o.gift.chargedMinor);
  else {
    const values = await fairValuesOfTypesTx(
      tx,
      o.lines.map((l) => l.ticketTypeId),
    );
    if (values.size === 0) return null;
    amounts = ticketReceiptAmounts(
      o.lines.map((l) => {
        const v = values.get(l.ticketTypeId);
        return {
          name: l.name,
          quantity: l.quantity,
          unitPaidMinor: l.unitPaidMinor,
          unitFmvMinor: v ? v.fmvMinor : null,
          description: v?.description ?? null,
        };
      }),
    );
  }
  const profile = await charityProfileTx(tx);
  const deductible = isDeductibleReceipt({
    charityStatus: (profile?.status ?? null) as CharityStatus | null,
    fundsFlow: o.fundsFlow,
    currency: o.currency,
  });
  const org = await organizationDefaultsTx(tx, orgId);
  const orgName = (await organizationNameTx(tx, orgId)) ?? '';
  const paidAt = o.paidAt ?? now;
  const sponsored = deductible && profile?.exemptKind === 'fiscal_sponsor';
  const [row] = await tx
    .insert(receipts)
    .values({
      orgId,
      eventId: o.eventId,
      orderId: o.id,
      giftId: o.gift?.giftId ?? null,
      number: await nextNumberTx(tx, orgId, now),
      kind: o.gift ? 'gift' : 'ticket',
      deductible,
      donorName: o.buyerName.slice(0, 120) || '—',
      donorEmail: o.buyerEmail.trim().toLowerCase(),
      locale: o.locale,
      currency: o.currency,
      amountMinor: amounts.amountMinor,
      fmvMinor: amounts.fmvMinor,
      deductibleMinor: deductible ? amounts.deductibleMinor : 0,
      goods: amounts.goods ? amounts.goods.slice(0, 2000) : null,
      charityName: (deductible && profile ? profile.legalName : profile?.legalName || orgName).slice(0, 200),
      charityEin: deductible && profile ? profile.ein : null,
      sponsorName: sponsored ? profile.sponsorName : null,
      sponsorEin: sponsored ? profile.sponsorEin : null,
      charityAddress: deductible ? (profile?.address ?? null) : null,
      paidAt,
      taxYear: taxYearOf(paidAt, org?.timezone ?? 'UTC'),
      copyVersion: RECEIPT_COPY_VERSION,
    })
    .returning();
  if (!row) throw new DomainError('internal');
  return { receipt: row, issued: true };
}

/** A receipt's document fields (the PDF, the email body and the console). */
async function receiptDocTx(tx: TenantTx, r: ReceiptRow): Promise<ReceiptDocInput> {
  const ev = await findEventTx(tx, r.eventId);
  const org = await organizationDefaultsTx(tx, r.orgId);
  return {
    number: r.number,
    deductible: r.deductible,
    donorName: r.donorName,
    currency: r.currency,
    amountMinor: r.amountMinor,
    fmvMinor: r.fmvMinor,
    deductibleMinor: r.deductibleMinor,
    goods: r.goods,
    charityName: r.charityName,
    charityEin: r.charityEin,
    sponsorName: r.sponsorName,
    sponsorEin: r.sponsorEin,
    charityAddress: r.charityAddress,
    eventName: ev?.name ?? '',
    paidAt: r.paidAt,
    timeZone: org?.timezone ?? 'UTC',
  };
}

const PaidPayload = z.object({ orgId: z.uuid(), orderId: z.uuid() });

/**
 * Receipts follow payments (outbox → worker; the dev drain in dev and e2e): a paid gift order
 * (`order.donation_paid@1`) or ticket order (`order.paid@1`) gets its receipt, and the receipt is
 * emailed to the donor only (P4-13), with the PDF link. Idempotent: one receipt per order, one
 * message per receipt (dedupe key).
 */
export function receiptIssuer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'donations.receipt-issuer',
    events: ['order.paid@1', 'order.donation_paid@1'],
    handle: async (tx, event) => {
      const p = PaidPayload.parse(event.payload);
      const out = await issueReceiptTx(tx, p.orgId, p.orderId, new Date());
      if (!out) return;
      const r = out.receipt;
      const doc = await receiptDocTx(tx, r);
      const ev = await findEventTx(tx, r.eventId);
      await deps.notifier.enqueue(tx, {
        kind: 'donations.receipt',
        to: { email: r.donorEmail, name: r.donorName, userId: null, locale: r.locale, timeZone: null },
        params: {
          url: receiptUrl(deps.appOrigin, r),
          name: r.donorName,
          eventName: ev?.name ?? '',
          amountMinor: r.amountMinor,
          currency: r.currency,
          deductible: r.deductible ? 'yes' : 'no',
          body: receiptEmailBody(doc, r.locale),
        },
        dedupeKey: `receipt:${r.id}`,
        orderId: r.orderId,
        eventId: r.eventId,
      });
    },
  });
}

/** Issue this org's receipts the subscriber has not handled yet (console pages; dev has no worker). */
export function catchUpReceipts(orgId: string, deps: { notifier: Notifier; appOrigin: string }) {
  return catchUpSubscriber(receiptIssuer(deps), orgId);
}

// ── the host's views ──────────────────────────────────────────────────────────────────────

export const HostReceiptDto = z.object({
  id: z.uuid(),
  number: z.int(),
  kind: z.enum(RECEIPT_KINDS),
  deductible: z.boolean(),
  /** The organizer always sees who gave: receipts need it (P4-13). */
  donorName: z.string(),
  currency: z.string(),
  amountMinor: z.int(),
  fmvMinor: z.int(),
  deductibleMinor: z.int(),
  paidAt: z.date(),
});
export type HostReceiptDto = z.infer<typeof HostReceiptDto>;

export const FairValueRowDto = z.object({
  ticketTypeId: z.uuid(),
  name: z.string(),
  priceMinor: z.int(),
  currency: z.string(),
  isDonation: z.boolean(),
  fmvMinor: z.int().nullable(),
  description: z.string().nullable(),
});
export type FairValueRowDto = z.infer<typeof FairValueRowDto>;

export const ReceiptsConsoleDto = z.object({
  charityStatus: z.enum(CHARITY_STATUSES).nullable(),
  ticketTypes: z.array(FairValueRowDto),
  receipts: z.array(HostReceiptDto),
});
export type ReceiptsConsoleDto = z.infer<typeof ReceiptsConsoleDto>;

/** The event's receipts page: the charity's status, fair-market values per ticket type, receipts. */
export const receiptsConsoleQuery = tenantQuery({
  name: 'donations.receiptsConsole',
  input: z.object({ eventId: z.uuid() }),
  output: ReceiptsConsoleDto,
  entitlement: 'donations',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const profile = await charityProfileTx(tx);
    const values = await fairValuesOfEventTx(tx, event.id);
    const types = (await ticketTypePricesTx(tx, event.id, ctx.now)).filter((t) => !t.archived);
    const rows = await tx
      .select()
      .from(receipts)
      .where(eq(receipts.eventId, event.id))
      .orderBy(desc(receipts.number))
      .limit(500);
    return {
      charityStatus: (profile?.status ?? null) as CharityStatus | null,
      ticketTypes: types.map((t) => ({
        ticketTypeId: t.id,
        name: t.name,
        priceMinor: t.priceMinor,
        currency: t.currency,
        isDonation: t.isDonation,
        fmvMinor: values.get(t.id)?.fmvMinor ?? null,
        description: values.get(t.id)?.description ?? null,
      })),
      receipts: rows.map((r) => ({
        id: r.id,
        number: r.number,
        kind: r.kind,
        deductible: r.deductible,
        donorName: r.donorName,
        currency: r.currency,
        amountMinor: r.amountMinor,
        fmvMinor: r.fmvMinor,
        deductibleMinor: r.deductibleMinor,
        paidAt: r.paidAt,
      })),
    };
  },
});

export const ReceiptDocumentDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  locale: z.string(),
  doc: z.custom<ReceiptDocInput>(),
});
export type ReceiptDocumentDto = z.infer<typeof ReceiptDocumentDto>;

/** One receipt's document for the host's PDF (anyone who reads orders). */
export const receiptDocumentQuery = tenantQuery({
  name: 'donations.receiptDocument',
  input: z.object({ receiptId: z.uuid() }),
  output: ReceiptDocumentDto,
  entitlement: 'donations',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const [r] = await tx.select().from(receipts).where(eq(receipts.id, input.receiptId));
    if (!r) throw new DomainError('not_found', 'Receipt not found');
    return { id: r.id, eventId: r.eventId, locale: r.locale, doc: await receiptDocTx(tx, r) };
  },
});

/** The donor's receipt by its signed link (the public PDF route): null when the link is not valid. */
export async function receiptByToken(orgId: string, token: string): Promise<ReceiptDocumentDto | null> {
  const id = verifyLinkToken(RECEIPT_PURPOSE, token);
  if (!id) return null;
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'donations.receipt' } });
  return withTenant(ctx, async (tx) => {
    const [r] = await tx.select().from(receipts).where(eq(receipts.id, id));
    return r ? { id: r.id, eventId: r.eventId, locale: r.locale, doc: await receiptDocTx(tx, r) } : null;
  });
}

// ── year-end statements ───────────────────────────────────────────────────────────────────

/** A statement's document fields: the statement and its receipts (that year, that donor). */
async function statementDocTx(tx: TenantTx, s: StatementRow): Promise<StatementDocInput> {
  const org = await organizationDefaultsTx(tx, s.orgId);
  const rows = await tx
    .select()
    .from(receipts)
    .where(
      and(
        eq(receipts.taxYear, s.taxYear),
        eq(receipts.donorEmail, s.donorEmail),
        eq(receipts.currency, s.currency),
        eq(receipts.deductible, true),
      ),
    )
    .orderBy(asc(receipts.paidAt), asc(receipts.number));
  const events = new Map<string, string>();
  for (const id of new Set(rows.map((r) => r.eventId)))
    events.set(id, (await findEventTx(tx, id))?.name ?? '');
  return {
    taxYear: s.taxYear,
    donorName: s.donorName,
    currency: s.currency,
    amountMinor: s.amountMinor,
    fmvMinor: s.fmvMinor,
    deductibleMinor: s.deductibleMinor,
    charityName: s.charityName,
    charityEin: s.charityEin,
    sponsorName: s.sponsorName,
    sponsorEin: s.sponsorEin,
    charityAddress: s.charityAddress,
    timeZone: org?.timezone ?? 'UTC',
    lines: rows
      .filter((r) => r.createdAt <= s.createdAt)
      .map((r) => ({
        number: r.number,
        paidAt: r.paidAt,
        eventName: events.get(r.eventId) ?? '',
        amountMinor: r.amountMinor,
        fmvMinor: r.fmvMinor,
        deductibleMinor: r.deductibleMinor,
      })),
  };
}

/**
 * Write the year-end giving statements of one org (the worker's daily pass; platform actor): for
 * the tax year due in the org's timezone (the previous calendar year) or `year`, one statement per
 * donor email and currency that had tax-deductible receipts and has no statement yet, totalling
 * them exactly. Each emits `donations.statement_issued@1` (the mailer sends it to the donor).
 */
export const yearEndStatementsCommand = tenantCommand({
  name: 'donations.yearEndStatements',
  input: z.object({ year: z.int().min(2000).max(2200).optional() }),
  output: z.object({ year: z.int(), issued: z.int() }),
  entitlement: null,
  permission: 'platform:donations.statements',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const org = await organizationDefaultsTx(tx, orgId);
    const year = input.year ?? statementYearDue(ctx.now, org?.timezone ?? 'UTC');
    if (year >= taxYearOf(ctx.now, org?.timezone ?? 'UTC'))
      throw new DomainError('invalid_state', 'That year is not over yet', { reason: 'year_open' });
    const rows = await tx
      .select()
      .from(receipts)
      .where(and(eq(receipts.taxYear, year), eq(receipts.deductible, true)))
      .orderBy(asc(receipts.paidAt), asc(receipts.number));
    const done = new Set(
      (
        await tx
          .select({ email: yearEndStatements.donorEmail, currency: yearEndStatements.currency })
          .from(yearEndStatements)
          .where(eq(yearEndStatements.taxYear, year))
      ).map((s) => `${s.email}|${s.currency}`),
    );
    const groups = new Map<string, ReceiptRow[]>();
    for (const r of rows) {
      const key = `${r.donorEmail}|${r.currency}`;
      if (done.has(key)) continue;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    let issued = 0;
    for (const list of groups.values()) {
      const last = list[list.length - 1] as ReceiptRow;
      const totals = statementTotals(list);
      const [s] = await tx
        .insert(yearEndStatements)
        .values({
          orgId,
          taxYear: year,
          donorEmail: last.donorEmail,
          donorName: last.donorName,
          locale: last.locale,
          currency: last.currency,
          receiptCount: totals.count,
          amountMinor: totals.amountMinor,
          fmvMinor: totals.fmvMinor,
          deductibleMinor: totals.deductibleMinor,
          charityName: last.charityName,
          charityEin: last.charityEin ?? '',
          sponsorName: last.sponsorName,
          sponsorEin: last.sponsorEin,
          charityAddress: last.charityAddress,
          copyVersion: RECEIPT_COPY_VERSION,
        })
        .onConflictDoNothing()
        .returning({ id: yearEndStatements.id });
      if (!s) continue;
      issued++;
      emit({
        type: 'donations.statement_issued',
        version: 1,
        aggregateType: 'year_end_statement',
        aggregateId: s.id,
        payload: { orgId, statementId: s.id, year },
      });
    }
    return { year, issued };
  },
  // No donor data in the audit log: the year and the count.
  audit: (_input, r) => ({
    action: 'donations.statements.issue',
    targetType: 'organization',
    targetId: null,
    data: { year: r.year, issued: r.issued },
  }),
});

const StatementPayload = z.object({ orgId: z.uuid(), statementId: z.uuid() });

/** A new year-end statement is mailed to its donor only, with the PDF link (once per statement). */
export function statementMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'donations.statement-mailer',
    events: ['donations.statement_issued@1'],
    handle: async (tx, event) => {
      const p = StatementPayload.parse(event.payload);
      const [s] = await tx.select().from(yearEndStatements).where(eq(yearEndStatements.id, p.statementId));
      if (!s) return;
      const doc = await statementDocTx(tx, s);
      await deps.notifier.enqueue(tx, {
        kind: 'donations.year-end-statement',
        to: { email: s.donorEmail, name: s.donorName, userId: null, locale: s.locale, timeZone: null },
        params: {
          url: statementUrl(deps.appOrigin, s),
          name: s.donorName,
          year: String(s.taxYear),
          amountMinor: s.deductibleMinor,
          currency: s.currency,
          body: statementEmailBody(doc, s.locale),
        },
        dedupeKey: `year-end-statement:${s.id}`,
      });
    },
  });
}

export const StatementDocumentDto = z.object({
  id: z.uuid(),
  locale: z.string(),
  doc: z.custom<StatementDocInput>(),
});
export type StatementDocumentDto = z.infer<typeof StatementDocumentDto>;

/** The donor's year-end statement by its signed link (the public PDF route). */
export async function statementByToken(orgId: string, token: string): Promise<StatementDocumentDto | null> {
  const id = verifyLinkToken(STATEMENT_PURPOSE, token);
  if (!id) return null;
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'donations.statement' } });
  return withTenant(ctx, async (tx) => {
    const [s] = await tx.select().from(yearEndStatements).where(eq(yearEndStatements.id, id));
    return s ? { id: s.id, locale: s.locale, doc: await statementDocTx(tx, s) } : null;
  });
}

/** This org's statements of a year (tests and the console): totals per donor. */
export async function statementsOfYearTx(tx: TenantTx, year: number) {
  return tx
    .select()
    .from(yearEndStatements)
    .where(eq(yearEndStatements.taxYear, year))
    .orderBy(asc(yearEndStatements.donorEmail));
}

/** Receipts of these orders (tests). */
export async function receiptsOfOrdersTx(tx: TenantTx, orderIds: readonly string[]) {
  if (orderIds.length === 0) return [];
  return tx
    .select()
    .from(receipts)
    .where(inArray(receipts.orderId, [...orderIds]));
}
