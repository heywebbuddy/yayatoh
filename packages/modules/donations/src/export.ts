import { csvRow } from '@yayatoh/csv';
import { findEventTx } from '@yayatoh/events';
import { DomainError, formatMoney, money } from '@yayatoh/kernel';
import { bulkCommands, defineBulkAction } from '@yayatoh/platform';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type DisplayAs, shownName, TRIBUTE_KINDS } from './domain/giving.ts';
import { campaigns, gifts, levels } from './schema.ts';

const Head = z.string().trim().min(1).max(60);

/** Column headers and words in the requester's language (the web passes them). */
export const GiftExportParams = z.object({
  headers: z.object({
    date: Head,
    campaign: Head,
    level: Head,
    amount: Head,
    feeCover: Head,
    donor: Head,
    email: Head,
    shownAs: Head,
    employer: Head,
    tribute: Head,
    tributeName: Head,
    tributeRecipient: Head,
    tributeNote: Head,
  }),
  anonymous: Head,
  tributes: z.record(z.enum(TRIBUTE_KINDS), Head),
  locale: z.string().min(2).max(10).default('en'),
});

/** `YYYY-MM-DD HH:mm` in the event's time zone. */
function localStamp(d: Date, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/**
 * The event's paid gifts as CSV (M4.8a, P4-17 employer list): the donor's name and email (the
 * organizer always sees who gave, P4-13), how they chose to appear, employer and tribute. A bulk
 * export: `attendees:export`, a recent step-up, audited, refused while staff act as a member.
 */
export const giftsExportAction = defineBulkAction({
  key: 'donations.giftsCsv',
  entitlement: 'donations',
  permission: 'attendees:export',
  params: GiftExportParams,
  filter: z.object({}),
  chunkSize: 1_000,
  file: {
    contentType: 'text/csv; charset=utf-8',
    name: (_p, now) => `gifts-${now.toISOString().slice(0, 10)}.csv`,
  },
  resolve: async (tx, sel) => {
    if (!sel.eventId) throw new DomainError('validation_failed', 'An event is required');
    const rows = await tx
      .select({ id: gifts.id })
      .from(gifts)
      .where(and(eq(gifts.eventId, sel.eventId), eq(gifts.status, 'paid')))
      .orderBy(asc(gifts.paidAt), asc(gifts.id));
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
    const rows = ids.length
      ? await tx
          .select({
            g: gifts,
            campaign: campaigns.name,
            level: levels.name,
          })
          .from(gifts)
          .innerJoin(campaigns, eq(campaigns.id, gifts.campaignId))
          .leftJoin(levels, eq(levels.id, gifts.levelId))
          .where(and(inArray(gifts.id, [...ids]), eq(gifts.eventId, event.id)))
          .orderBy(desc(gifts.paidAt))
      : [];
    const byId = new Map(rows.map((r) => [r.g.id, r]));
    const h = params.headers;
    let out = meta.first
      ? `﻿${csvRow([
          h.date,
          h.campaign,
          h.level,
          h.amount,
          h.feeCover,
          h.donor,
          h.email,
          h.shownAs,
          h.employer,
          h.tribute,
          h.tributeName,
          h.tributeRecipient,
          h.tributeNote,
        ])}`
      : '';
    const results = [];
    const fmt = (minor: number, currency: string) =>
      formatMoney(money(minor, currency), params.locale).replace(/ /g, ' ');
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) {
        results.push({ id, ok: false, code: 'not_found' });
        continue;
      }
      const g = r.g;
      out += csvRow([
        localStamp(g.paidAt ?? g.createdAt, event.timezone),
        r.campaign,
        r.level ?? '',
        fmt(g.amountMinor, g.currency),
        fmt(g.feeCoverMinor, g.currency),
        g.donorName,
        g.donorEmail,
        shownName(g.donorName, g.displayAs as DisplayAs) ?? params.anonymous,
        g.employer ?? '',
        g.tributeKind ? (params.tributes[g.tributeKind as (typeof TRIBUTE_KINDS)[number]] ?? '') : '',
        g.tributeName ?? '',
        g.tributeRecipient ?? '',
        g.tributeNote ?? '',
      ]);
      results.push({ id, ok: true });
    }
    return { results, append: out };
  },
});

export const giftsExportBulk = bulkCommands(giftsExportAction);
