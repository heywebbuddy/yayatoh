import { AttendeeFilter, attendeesForExportTx, resolveAttendeeIdsTx } from '@yayatoh/attendees';
import { admittedTicketIdsTx } from '@yayatoh/checkin';
import { csvRow } from '@yayatoh/csv';
import { findEventTx } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';
import { bulkCommands, defineBulkAction } from '@yayatoh/platform';
import { ticketSummariesTx } from '@yayatoh/ticketing';
import { z } from 'zod';

export const ATTENDEE_EXPORT_COLUMNS = [
  'name',
  'email',
  'ticketType',
  'ticketCode',
  'serial',
  'source',
  'status',
  'labels',
  'registeredAt',
  'checkedIn',
] as const;

const Text = z.string().trim().min(1).max(60);

/** Localized header and yes/no words come from the requester's UI, so the file reads in their language. */
const ExportParams = z.object({
  headers: z.object(
    Object.fromEntries(ATTENDEE_EXPORT_COLUMNS.map((c) => [c, Text])) as Record<
      (typeof ATTENDEE_EXPORT_COLUMNS)[number],
      typeof Text
    >,
  ),
  yes: Text,
  no: Text,
});

/** `YYYY-MM-DD HH:mm` in the event's timezone (spreadsheet-friendly, unambiguous). */
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
 * The attendee list as CSV (an allowlist of columns), written chunk by chunk into the
 * operation's file. Registration times use the event's timezone.
 */
export const attendeeExportAction = defineBulkAction({
  key: 'reports.attendeesCsv',
  entitlement: 'attendees',
  permission: 'attendees:export',
  params: ExportParams,
  filter: AttendeeFilter,
  chunkSize: 1_000,
  file: {
    contentType: 'text/csv; charset=utf-8',
    name: (_p, now) => `attendees-${now.toISOString().slice(0, 10)}.csv`,
  },
  resolve: resolveAttendeeIdsTx,
  run: async (tx, _ctx, ids, params, meta) => {
    if (!meta.eventId) throw new DomainError('validation_failed', 'An event is required');
    const event = await findEventTx(tx, meta.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const rows = await attendeesForExportTx(tx, ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ticketIds = rows.flatMap((r) => (r.ticketId ? [r.ticketId] : []));
    const tickets = new Map((await ticketSummariesTx(tx, ticketIds)).map((t) => [t.id, t]));
    const admitted = await admittedTicketIdsTx(tx, event.id, ticketIds);
    // Excel opens UTF-8 correctly only with a byte-order mark.
    let out = meta.first ? `﻿${csvRow(ATTENDEE_EXPORT_COLUMNS.map((c) => params.headers[c]))}` : '';
    const results = [];
    for (const id of ids) {
      const a = byId.get(id);
      if (!a) {
        results.push({ id, ok: false, code: 'not_found' });
        continue;
      }
      const t = a.ticketId ? tickets.get(a.ticketId) : undefined;
      out += csvRow([
        a.name,
        a.email,
        t?.ticketTypeName,
        t?.shortCode,
        t?.serial,
        a.source,
        a.status,
        a.labels.join('; '),
        localStamp(a.createdAt, event.timezone),
        a.ticketId && admitted.has(a.ticketId) ? params.yes : params.no,
      ]);
      results.push({ id, ok: true });
    }
    return { results, append: out };
  },
});

export const attendeeExportBulk = bulkCommands(attendeeExportAction);
