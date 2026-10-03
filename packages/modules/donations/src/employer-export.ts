import { csvRow } from '@yayatoh/csv';
import { findEventTx } from '@yayatoh/events';
import { DomainError, formatMoney, money } from '@yayatoh/kernel';
import { bulkCommands, defineBulkAction } from '@yayatoh/platform';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { matchableAmount } from './domain/matches.ts';
import { campaigns, gifts } from './schema.ts';
import { giftRefunds } from './schema-matches.ts';

const Head = z.string().trim().min(1).max(60);

/** Column headers in the requester's language (the web passes them). */
export const EmployerExportParams = z.object({
  headers: z.object({
    employer: Head,
    donor: Head,
    email: Head,
    date: Head,
    campaign: Head,
    amount: Head,
  }),
  locale: z.string().min(2).max(10).default('en'),
});

/** `YYYY-MM-DD` in the event's time zone. */
function localDate(d: Date, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * The employer matching list (M4.8f, P4-17): the event's paid gifts whose donor named an employer,
 * grouped by employer, with the donor's name and email (so the charity can file each employer's
 * matching request) and the amount given less refunds. Fully refunded gifts are left out. A bulk
 * export like the gift list: `attendees:export`, a recent step-up, audited, refused while staff act
 * as a member. A paid matching-gift database integration waits for the owner (P4-17).
 */
export const employerExportAction = defineBulkAction({
  key: 'donations.employerCsv',
  entitlement: 'donations',
  permission: 'attendees:export',
  params: EmployerExportParams,
  filter: z.object({}),
  chunkSize: 1_000,
  file: {
    contentType: 'text/csv; charset=utf-8',
    name: (_p, now) => `employer-matching-${now.toISOString().slice(0, 10)}.csv`,
  },
  resolve: async (tx, sel) => {
    if (!sel.eventId) throw new DomainError('validation_failed', 'An event is required');
    const rows = await tx
      .select({ id: gifts.id })
      .from(gifts)
      .where(and(eq(gifts.eventId, sel.eventId), eq(gifts.status, 'paid'), isNotNull(gifts.employer)))
      .orderBy(sql`lower(${gifts.employer})`, asc(gifts.paidAt), asc(gifts.id));
    const ids = rows.map((r) => r.id);
    if (sel.ids) {
      const ok = new Set(ids);
      return sel.ids.filter((id) => ok.has(id));
    }
    return ids;
  },
  run: async (tx, _ctx, ids, params, meta) => {
    if (!meta.eventId) throw new DomainError('validation_failed', 'An event is required');
    const event = await findEventTx(tx, meta.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const [rows, refunded] = ids.length
      ? await Promise.all([
          tx
            .select({ g: gifts, campaign: campaigns.name })
            .from(gifts)
            .innerJoin(campaigns, eq(campaigns.id, gifts.campaignId))
            .where(and(inArray(gifts.id, [...ids]), eq(gifts.eventId, event.id))),
          tx
            .select({ giftId: giftRefunds.giftId, sum: sql<string>`sum(${giftRefunds.amountMinor})::text` })
            .from(giftRefunds)
            .where(inArray(giftRefunds.giftId, [...ids]))
            .groupBy(giftRefunds.giftId),
        ])
      : [[], []];
    const byId = new Map(rows.map((r) => [r.g.id, r]));
    const refunds = new Map(refunded.map((r) => [r.giftId, Number(r.sum)]));
    const h = params.headers;
    let out = meta.first ? `﻿${csvRow([h.employer, h.donor, h.email, h.date, h.campaign, h.amount])}` : '';
    const results = [];
    const fmt = (minor: number, currency: string) =>
      formatMoney(money(minor, currency), params.locale).replace(/ /g, ' ');
    for (const id of ids) {
      const r = byId.get(id);
      if (!r?.g.employer) {
        results.push({ id, ok: false, code: 'not_found' });
        continue;
      }
      const g = r.g;
      const net = matchableAmount({ ...g, refundedMinor: refunds.get(g.id) ?? 0 });
      if (net <= 0) {
        // Refunded in full: nothing for the employer to match.
        results.push({ id, ok: true });
        continue;
      }
      out += csvRow([
        g.employer,
        g.donorName,
        g.donorEmail,
        localDate(g.paidAt ?? g.createdAt, event.timezone),
        r.campaign,
        fmt(net, g.currency),
      ]);
      results.push({ id, ok: true });
    }
    return { results, append: out };
  },
});

export const employerExportBulk = bulkCommands(employerExportAction);
