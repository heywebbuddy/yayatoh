import {
  type AttendeeSyncRow,
  addGuestCommand,
  attendeeSyncRowTx,
  attendeesChangedSinceTx,
  reassignAttendeeTx,
  setAttendeeLabelsCommand,
} from '@yayatoh/attendees';
import { upsertContactTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { nameTicketHolderTx } from '@yayatoh/ticketing';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { sheetLinks } from '../../schema.ts';
import {
  defineConnector,
  type LocalRecord,
  type RemoteRecord,
  type SyncIO,
  type WriteMeta,
} from '../../sdk/connector.ts';
import { googleSheetsFakeProvider } from './fake.ts';
import {
  APPEND_RANGE,
  cellRange,
  idempotencyHash,
  planWrite,
  READ_RANGE,
  readGrid,
  SHEET_COLUMNS,
  type SheetRow,
  SYNC_LABEL,
  syncColumn,
  valuesPath,
} from './grid.ts';

export { SHEET_COLUMNS };

/**
 * Google Sheets live sync (M6.4b, decision P6-4 step 3): an event's attendee list, two ways, with a
 * spreadsheet per linked event. Columns come from the push mapping (Yayatoh field → column); our
 * edits push on the next run, sheet edits pull on the next run.
 *
 * - **The real Sheets API v4** through the port (Nango proxies to sheets.googleapis.com): the
 *   "Attendees" tab is read whole with `GET values/Attendees!A1:Z`, rows are appended with
 *   `POST values/Attendees!A1:append` and updated (a row, or one stamp cell) with
 *   `PUT values/Attendees!A{n}:{col}{n}`, always `valueInputOption=RAW` (a typed `=` is text, never
 *   a formula). Linking creates the spreadsheet (`links.ts`).
 * - **Row identity and change detection** live in each row's hidden "Yayatoh sync" cell (`grid.ts`):
 *   Google has no row ids, edit times or change feed. A row a person typed in gets an id on first
 *   read and an edited row a new revision, both written back to the stamp; our writes stamp our
 *   origin, so they come back as our own.
 *
 * - **Rows ↔ attendees** through the record links (`<spreadsheet id>:<row id>` ↔ attendee id), so
 *   a round trip never duplicates: a row we wrote comes back with our version and origin and is
 *   skipped, an attendee the pull just wrote is not sent back.
 * - **A new row** typed into the sheet becomes a guest on the list (`attendees.addGuest`; an email
 *   already on the list is refused into the errors inbox, never a second attendee).
 * - **Edits:** a ticket holder's name or email is renamed on the ticket (`nameTicketHolderTx`), a
 *   guest's on the guest record; labels are set as typed (comma-separated).
 * - **Deleting a row never deletes an attendee:** the sheet is read in full every run (it has no
 *   change feed), and a linked row missing from it is flagged in the inbox (`remote_deleted`).
 *   Dismissing the flag unties the attendee from that row.
 * - **Conflicts: last writer by row timestamp.** When both the row and the attendee changed since
 *   the last sync, the later change wins (the row's last-edit time against the attendee's update
 *   time); the losing values land in the errors inbox beside the conflict. A person's edit has no
 *   time at Google: it counts from the run that first reads it.
 */

export const GOOGLE_SHEETS = 'google_sheets';

export interface SheetScope extends Readonly<Record<string, unknown>> {
  readonly links: readonly { readonly eventId: string; readonly spreadsheetId: string }[];
}

const linksOf = (scope: Readonly<Record<string, unknown>>): SheetScope['links'] =>
  Array.isArray(scope.links) ? (scope.links as SheetScope['links']) : [];

/** The record id of a row: unique across the connection's spreadsheets. */
export const rowRecordId = (spreadsheetId: string, rowId: string) => `${spreadsheetId}:${rowId}`;
const splitId = (id: string) => {
  const i = id.indexOf(':');
  return i > 0 ? { spreadsheetId: id.slice(0, i), rowId: id.slice(i + 1) } : null;
};

function rowRecord(spreadsheetId: string, r: SheetRow): RemoteRecord {
  const at = new Date(r.updatedAt);
  return {
    id: rowRecordId(spreadsheetId, r.rowId),
    version: String(r.rev),
    updatedAt: Number.isNaN(at.getTime()) ? null : at,
    origin: r.origin,
    fields: { ...r.values },
  };
}

const ValuesBody = z.object({ values: z.array(z.array(z.unknown())).optional() });

/** The tab's cells as text (Google leaves out trailing empty cells and rows). */
async function readCells(io: SyncIO, spreadsheetId: string): Promise<string[][]> {
  const res = await io.client.request({
    method: 'GET',
    path: valuesPath(spreadsheetId, READ_RANGE),
    query: { majorDimension: 'ROWS' },
  });
  return (ValuesBody.parse(res.body ?? {}).values ?? []).map((row) =>
    row.map((c) => (c === null || c === undefined ? '' : String(c))),
  );
}

async function putCells(
  io: SyncIO,
  spreadsheetId: string,
  range: string,
  values: string[][],
  idempotencyKey?: string,
) {
  await io.client.request({
    method: 'PUT',
    path: valuesPath(spreadsheetId, range),
    query: { valueInputOption: 'RAW' },
    body: { range, majorDimension: 'ROWS', values },
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

/** A new row id (the stamp's `id`; record ids are `<spreadsheet id>:<row id>`). */
function newRowId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return `r${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

/**
 * Every row of the sheet. Rows typed in or edited by a person since the last read get their
 * stamp written back first (one cell each), so their ids and revisions hold from now on.
 */
async function readRows(io: SyncIO, spreadsheetId: string): Promise<SheetRow[]> {
  const { header, rows } = readGrid(await readCells(io, spreadsheetId), { now: io.now, newId: newRowId });
  const col = syncColumn(header);
  const stale = rows.filter((r) => r.writeBack !== null);
  if (stale.length && header.sync === null)
    await putCells(io, spreadsheetId, cellRange(1, col), [[SYNC_LABEL]]);
  for (const r of stale)
    await putCells(io, spreadsheetId, cellRange(r.rowNumber, col), [[r.writeBack as string]]);
  return rows.map((r) => r.row);
}

const labelsOf = (s: unknown) =>
  typeof s === 'string'
    ? [
        ...new Set(
          s
            .split(',')
            .map((l) => l.trim())
            .filter(Boolean),
        ),
      ]
    : [];

const toLocal = (a: AttendeeSyncRow): LocalRecord => ({
  id: a.id,
  updatedAt: a.updatedAt,
  fields: {
    name: a.name,
    email: a.email,
    labels: [...a.labels].sort().join(', '),
    status: a.status,
    // Not a column: which sheet the attendee belongs in.
    event_id: a.eventId,
  },
});

async function eventOfSheetTx(tx: TenantTx, connectionId: string, spreadsheetId: string) {
  const [link] = await tx
    .select({ eventId: sheetLinks.eventId })
    .from(sheetLinks)
    .where(
      and(
        eq(sheetLinks.connectionId, connectionId),
        eq(sheetLinks.spreadsheetId, spreadsheetId),
        eq(sheetLinks.status, 'active'),
      ),
    );
  if (!link)
    throw new DomainError('not_found', 'This sheet is not linked any more', { reason: 'not_linked' });
  return link.eventId;
}

const noStepUp = async () => {};

async function writeRow(
  tx: TenantTx,
  ctx: Ctx,
  values: Readonly<Record<string, unknown>>,
  localId: string | null,
  meta: WriteMeta,
) {
  const where = splitId(meta.record.id);
  if (!where) throw new DomainError('validation_failed', 'Not a sheet row');
  const eventId = await eventOfSheetTx(tx, meta.connectionId, where.spreadsheetId);
  const name = String(values.name ?? '').trim();
  const email = String(values.email ?? '').trim();
  const labels = labelsOf(values.labels);
  const args = { ctx, tx, emit: meta.emit, requireStepUp: noStepUp };
  if (!localId) {
    // A row typed into the sheet: a guest on the list (an email already there is refused).
    const row = await addGuestCommand.handler({
      ...args,
      input: addGuestCommand.input.parse({ eventId, name, email, labels }),
    });
    return { localId: row.id };
  }
  const current = await attendeeSyncRowTx(tx, localId);
  if (!current || current.eventId !== eventId) throw new DomainError('not_found', 'Attendee not found');
  if (current.name !== name || current.email.toLowerCase() !== email.toLowerCase()) {
    if (current.ticketId) await nameTicketHolderTx(tx, ctx, current.ticketId, { name, email });
    else {
      const contact = await upsertContactTx(tx, ctx, { email, name, source: 'import' });
      await reassignAttendeeTx(tx, ctx, current.id, { contactId: contact.id, name, email });
    }
  }
  const have = new Set(current.labels);
  const add = labels.filter((l) => !have.has(l));
  const remove = current.labels.filter((l) => !labels.includes(l));
  if (add.length || remove.length)
    await setAttendeeLabelsCommand.handler({
      ...args,
      input: setAttendeeLabelsCommand.input.parse({ eventId, attendeeIds: [current.id], add, remove }),
    });
  return { localId: current.id };
}

export const googleSheetsConnector = defineConnector({
  key: GOOGLE_SHEETS,
  name: 'Google Sheets',
  // The integration's id at Nango (the owner names it so when configuring Google there).
  providerConfigKey: 'google_sheets',
  scopes: ['https://www.googleapis.com/auth/drive.file'],
  entitlement: 'integrations',
  availability: 'general',
  fake: googleSheetsFakeProvider,
  async loadScope(tx, connectionId): Promise<SheetScope> {
    const links = await tx
      .select({ eventId: sheetLinks.eventId, spreadsheetId: sheetLinks.spreadsheetId })
      .from(sheetLinks)
      .where(and(eq(sheetLinks.connectionId, connectionId), eq(sheetLinks.status, 'active')));
    return { links };
  },
  objects: [
    {
      key: 'attendees',
      remoteFields: SHEET_COLUMNS.map((c) => ({ key: c.key, label: c.label, type: c.type })),
      localFields: [
        { key: 'name', label: 'name', type: 'string', required: true },
        { key: 'email', label: 'email', type: 'email', required: true },
        { key: 'labels', label: 'labels', type: 'string' },
        { key: 'status', label: 'status', type: 'string' },
      ],
      pull: {
        snapshot: true,
        conflicts: 'inbox',
        defaultMapping: [
          { source: 'name', target: 'name', transform: 'trim', default: null },
          { source: 'email', target: 'email', transform: 'lowercase', default: null },
          { source: 'labels', target: 'labels', transform: 'trim', default: null },
        ],
        async list(io) {
          const records: RemoteRecord[] = [];
          for (const link of linksOf(io.scope))
            for (const r of await readRows(io, link.spreadsheetId))
              records.push(rowRecord(link.spreadsheetId, r));
          // The whole set, every run: there is no change feed on a sheet.
          return { records, cursor: null, hasMore: false };
        },
        async get(io, externalId) {
          const where = splitId(externalId);
          if (!where || !linksOf(io.scope).some((l) => l.spreadsheetId === where.spreadsheetId)) return null;
          const row = (await readRows(io, where.spreadsheetId)).find((r) => r.rowId === where.rowId);
          return row ? rowRecord(where.spreadsheetId, row) : null;
        },
        write: writeRow,
      },
      push: {
        defaultMapping: [
          { source: 'name', target: 'name', transform: 'none', default: null },
          { source: 'email', target: 'email', transform: 'none', default: null },
          { source: 'labels', target: 'labels', transform: 'none', default: null },
          { source: 'status', target: 'status', transform: 'none', default: null },
        ],
        async changes(tx, cursor, limit, meta) {
          const eventIds = linksOf(meta.scope).map((l) => l.eventId);
          const rows = await attendeesChangedSinceTx(tx, eventIds, cursor, limit);
          return {
            records: rows.map(toLocal),
            cursor: rows[rows.length - 1]?.cursor ?? null,
            hasMore: rows.length === limit,
          };
        },
        async read(tx, localId) {
          const a = await attendeeSyncRowTx(tx, localId);
          return a ? toLocal(a) : null;
        },
        async send(io, input) {
          const eventId = input.local.fields.event_id;
          const link = linksOf(io.scope).find((l) => l.eventId === eventId);
          if (!link)
            throw new DomainError('invalid_state', 'The event has no linked sheet', { reason: 'not_linked' });
          const where = input.externalId ? splitId(input.externalId) : null;
          const sid = link.spreadsheetId;
          // Per sheet: the same record and content sent to a newly linked sheet is a new write.
          const key = `${input.idempotencyKey}:${sid}`;
          // Google has no Idempotency-Key: the sheet itself says whether this write already landed.
          const { plan, header } = planWrite(await readCells(io, sid), {
            rowId: where && where.spreadsheetId === sid ? where.rowId : null,
            values: input.values,
            k: idempotencyHash(key),
            origin: io.origin,
            now: io.now,
            newId: newRowId,
          });
          if (plan.kind !== 'none' && header.sync === null)
            await putCells(io, sid, cellRange(1, syncColumn(header)), [[SYNC_LABEL]]);
          if (plan.kind === 'update') await putCells(io, sid, plan.range, [plan.cells], key);
          if (plan.kind === 'append')
            await io.client.request({
              method: 'POST',
              path: valuesPath(sid, APPEND_RANGE, ':append'),
              query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
              body: { values: [plan.cells] },
              idempotencyKey: key,
            });
          return { externalId: rowRecordId(sid, plan.rowId), version: String(plan.rev) };
        },
      },
    },
  ],
});
