import { csvRow } from '@yayatoh/csv';
import { findEventTx } from '@yayatoh/events';
import { currencyExponent, DomainError } from '@yayatoh/kernel';
import { BookingSelection, bookingIdsTx, bookingRowsTx } from '@yayatoh/orders';
import { bulkCommands, defineBulkAction, MAX_BULK_ITEMS } from '@yayatoh/platform';
import { z } from 'zod';
import { localStamp } from './format.ts';

export const BOOKING_EXPORT_COLUMNS = [
  'reference',
  'buyerName',
  'buyerEmail',
  'status',
  'tickets',
  'total',
  'currency',
  'promoCode',
  'channel',
  'bookedAt',
  'paidAt',
] as const;

const Text = z.string().trim().min(1).max(60);

/** Localized headers and words come from the requester's UI, so the file reads in their language. */
const ExportParams = z.object({
  headers: z.object(
    Object.fromEntries(BOOKING_EXPORT_COLUMNS.map((c) => [c, Text])) as Record<
      (typeof BOOKING_EXPORT_COLUMNS)[number],
      typeof Text
    >,
  ),
  /** Status labels by order status, and channel labels. */
  statuses: z.record(z.string().max(40), Text),
  channels: z.object({ platform: Text, organizer: Text }),
});

/** Minor units as a plain decimal ("12.50"), the way spreadsheets expect money. */
export function decimal(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  if (exp === 0) return `${sign}${abs}`;
  const s = String(abs).padStart(exp + 1, '0');
  return `${sign}${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

/**
 * Bookings as CSV (M1.12c): an allowlist of columns — never payment ids, tokens or fee
 * schedules. Written chunk by chunk into the operation's file through the bulk framework (up to
 * 50 000 rows); times in the event's timezone. Buyer contact data leaves the platform, so it
 * needs the export permission.
 */
export const bookingsExportAction = defineBulkAction({
  key: 'reports.bookingsCsv',
  entitlement: 'reports',
  permission: 'attendees:export',
  params: ExportParams,
  filter: BookingSelection,
  chunkSize: 2_000,
  file: {
    contentType: 'text/csv; charset=utf-8',
    name: (_p, now) => `bookings-${now.toISOString().slice(0, 10)}.csv`,
  },
  resolve: async (tx, sel) => {
    if (!sel.eventId) throw new DomainError('validation_failed', 'An event is required');
    if (sel.ids) throw new DomainError('validation_failed', 'Export bookings by search and filter');
    // One past the cap, so the framework refuses an oversized selection instead of truncating it.
    return bookingIdsTx(tx, sel.eventId, sel.filter ?? BookingSelection.parse({}), MAX_BULK_ITEMS + 1);
  },
  run: async (tx, _ctx, ids, params, meta) => {
    if (!meta.eventId) throw new DomainError('validation_failed', 'An event is required');
    const event = await findEventTx(tx, meta.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const rows = new Map((await bookingRowsTx(tx, ids)).map((r) => [r.id, r]));
    // Excel opens UTF-8 correctly only with a byte-order mark.
    let out = meta.first ? `﻿${csvRow(BOOKING_EXPORT_COLUMNS.map((c) => params.headers[c]))}` : '';
    const results = [];
    for (const id of ids) {
      const b = rows.get(id);
      if (!b) {
        results.push({ id, ok: false, code: 'not_found' });
        continue;
      }
      out += csvRow([
        b.id,
        b.buyerName,
        b.buyerEmail,
        params.statuses[b.status] ?? b.status,
        b.tickets,
        decimal(b.totalMinor, b.currency),
        b.currency,
        b.promoCode,
        params.channels[b.collectedBy],
        localStamp(b.createdAt, event.timezone),
        b.paidAt ? localStamp(b.paidAt, event.timezone) : '',
      ]);
      results.push({ id, ok: true });
    }
    return { results, append: out };
  },
});

export const bookingsExportBulk = bulkCommands(bookingsExportAction);
