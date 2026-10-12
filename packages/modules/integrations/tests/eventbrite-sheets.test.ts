import { describe, expect, it } from 'vitest';
import type { FakeAccount } from '../src/auth/fake.ts';
import { providerPath } from '../src/auth/port.ts';
import { CONFLICT_CODES, conflictFields, REMOTE_DELETED, retryable } from '../src/client.ts';
import { eventRecord, orderRecord, ticketClassRecord } from '../src/connectors/eventbrite/index.ts';
import {
  connectorByKey,
  EB_EVENTS,
  EB_EVENTS_PAGE,
  EB_ORDERS,
  EB_ORDERS_PAGE,
  EVENTBRITE_FIXTURE_COUNTS,
  eventbriteConnector,
  eventbriteFakeProvider,
  eventbriteRemoteRefund,
  googleSheetsConnector,
  googleSheetsFakeProvider,
  isImporter,
  offeredConnectors,
  rowRecordId,
  sheetsRemoteAdd,
  sheetsRemoteDelete,
  sheetsRemoteEdit,
  sheetsRemoteList,
  sheetsRemoteRows,
} from '../src/index.ts';

/** M6.4b pure pieces: conflict values, record normalization, the recorded fakes. */

const account = (seed: unknown): FakeAccount => ({
  authConnectionId: 'fake_x',
  orgId: 'org',
  connectionId: 'conn',
  providerConfigKey: 'x',
  revoked: false,
  accessToken: 't',
  refreshToken: 'r',
  tokenExpiresAt: 0,
  refreshes: 0,
  data: seed,
  failNext: [],
  log: [],
});

describe('conflicts and inbox rules', () => {
  it('lists only the fields whose losing value differs (as text, trimmed)', () => {
    expect(
      conflictFields(
        ['name', 'email', 'labels', 'status'],
        { name: 'Ada', email: 'ada@x.test', labels: 'vip', status: null },
        { name: 'Ada ', email: 'ADA@x.test', labels: '', status: undefined },
      ),
    ).toEqual([
      { field: 'email', kept: 'ada@x.test', lost: 'ADA@x.test' },
      { field: 'labels', kept: 'vip', lost: '' },
    ]);
    expect(conflictFields(['n'], { n: 'x'.repeat(2000) }, { n: 1 })[0]?.kept).toHaveLength(1000);
  });

  it('a decided conflict or a deleted row is never retried', () => {
    expect(retryable({ step: 'conflict', code: CONFLICT_CODES[0] })).toBe(false);
    expect(retryable({ step: 'pull', code: REMOTE_DELETED })).toBe(false);
    expect(retryable({ step: 'pull', code: 'http_503' })).toBe(true);
    expect(retryable({ step: 'write', code: 'conflict' })).toBe(true);
  });
});

describe('connectors', () => {
  it('Eventbrite is an importer; Google Sheets syncs; both are offered with Nango and the fake', () => {
    expect(isImporter(eventbriteConnector)).toBe(true);
    expect(isImporter(googleSheetsConnector)).toBe(false);
    expect(eventbriteConnector.objects.map((o) => o.key)).toEqual(['events', 'ticket_classes', 'orders']);
    expect(eventbriteConnector.objects.every((o) => o.pull && !o.push)).toBe(true);
    expect(googleSheetsConnector.objects[0]?.pull?.snapshot).toBe(true);
    expect(googleSheetsConnector.objects[0]?.pull?.conflicts).toBe('inbox');
    for (const p of ['nango', 'fake'] as const)
      expect(offeredConnectors(p).map((c) => c.key)).toEqual(
        expect.arrayContaining(['eventbrite', 'google_sheets']),
      );
    expect(connectorByKey('google_sheets')?.providerConfigKey).toBe('google_sheets');
  });

  it('normalizes Eventbrite records: ids, versions, minor units, UTC instants and zones', () => {
    const e = eventRecord(EB_EVENTS[1] as (typeof EB_EVENTS)[number]);
    expect(e).toMatchObject({
      id: '710002',
      version: '2026-09-15T08:00:00Z',
      fields: {
        name: 'Rivers of Europe: a lecture',
        start_utc: '2026-11-12T18:30:00Z',
        timezone: 'Europe/Berlin',
        currency: 'EUR',
        country: 'DE',
      },
    });
    const free = ticketClassRecord(EB_EVENTS[0]?.ticket_classes[2] as never);
    expect(free?.fields).toMatchObject({ price: 0, event_id: '710001', name: 'Student (free)' });
    const vip = ticketClassRecord(EB_EVENTS[0]?.ticket_classes[1] as never);
    expect(vip?.fields.price).toBe(6000);
    // Content is the version of a ticket class: the same content, the same version.
    expect(ticketClassRecord(EB_EVENTS[0]?.ticket_classes[1] as never)?.version).toBe(vip?.version);
    const o = orderRecord(EB_ORDERS[0] as never);
    expect(o?.fields).toMatchObject({ base_price: 5000, gross: 5674, currency: 'USD', status: 'placed' });
    expect(o?.fields.attendees).toHaveLength(2);
    expect(eventRecord({ id: 1 } as never)).toBeNull();
  });

  it('the fixture adds up to its published counts (revenue to the cent)', () => {
    const revenue = new Map<string, number>();
    for (const o of EB_ORDERS)
      if (o.status === 'placed')
        revenue.set(o.costs.gross.currency, (revenue.get(o.costs.gross.currency) ?? 0) + o.costs.gross.value);
    expect([...revenue].sort().map(([currency, totalMinor]) => ({ currency, totalMinor }))).toEqual(
      EVENTBRITE_FIXTURE_COUNTS.revenue,
    );
    expect(EB_ORDERS.flatMap((o) => o.attendees)).toHaveLength(EVENTBRITE_FIXTURE_COUNTS.attendees);
    expect(EB_EVENTS.flatMap((e) => e.ticket_classes)).toHaveLength(EVENTBRITE_FIXTURE_COUNTS.ticketTypes);
  });
});

describe('the fake Eventbrite API', () => {
  const get = (a: FakeAccount, path: string, query: Record<string, string> = {}) =>
    eventbriteFakeProvider.handle(a, { method: 'GET', path, query }, 't');

  it('pages events and orders with continuation tokens, and filters orders by changed_since', () => {
    const a = account(eventbriteFakeProvider.seed());
    const org = get(a, '/v3/users/me/organizations/').body as { organizations: { id: string }[] };
    const id = org.organizations[0]?.id;
    const p1 = get(a, `/v3/organizations/${id}/events/`).body as {
      events: unknown[];
      pagination: { has_more_items: boolean; continuation?: string };
    };
    expect(p1.events).toHaveLength(EB_EVENTS_PAGE);
    expect(p1.pagination.has_more_items).toBe(true);
    const p2 = get(a, `/v3/organizations/${id}/events/`, { continuation: p1.pagination.continuation ?? '' })
      .body as { events: unknown[]; pagination: { has_more_items: boolean } };
    expect(p2.events).toHaveLength(1);
    expect(p2.pagination.has_more_items).toBe(false);
    const orders = get(a, `/v3/organizations/${id}/orders/`).body as { orders: { id: string }[] };
    expect(orders.orders).toHaveLength(EB_ORDERS_PAGE);
    eventbriteRemoteRefund(a, '5550002', new Date('2030-01-01T00:00:00Z'));
    const changed = get(a, `/v3/organizations/${id}/orders/`, { changed_since: '2029-01-01T00:00:00Z' })
      .body as { orders: { id: string; status: string }[] };
    expect(changed.orders.map((o) => [o.id, o.status])).toEqual([['5550002', 'refunded']]);
    expect(get(a, `/v3/organizations/${id}/events/`, { continuation: 'garbage' }).status).toBe(400);
    expect(get(a, '/v3/organizations/999/events/').status).toBe(404);
    expect(eventbriteFakeProvider.handle(a, { method: 'POST', path: '/v3/x' }, 't').status).toBe(405);
  });
});

describe('the fake Sheets API', () => {
  const call = (a: FakeAccount, req: Parameters<typeof googleSheetsFakeProvider.handle>[1]) =>
    googleSheetsFakeProvider.handle(a, req, 't');
  const values = (id: string, range: string, suffix = '') =>
    `/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}${suffix}`;

  it('creates a spreadsheet, writes, appends and reads values with Google shapes', () => {
    const a = account(googleSheetsFakeProvider.seed());
    const create = {
      method: 'POST' as const,
      path: '/v4/spreadsheets',
      body: {
        properties: { title: 'Gala · attendees' },
        sheets: [{ properties: { title: 'Attendees', gridProperties: { frozenRowCount: 1 } } }],
      },
      idempotencyKey: 'k0',
    };
    const created = call(a, create).body as {
      spreadsheetId: string;
      spreadsheetUrl: string;
      sheets: { properties: { sheetId: number; title: string } }[];
    };
    // Only the create is replayed per Idempotency-Key.
    expect(call(a, create).body).toEqual(created);
    const id = created.spreadsheetId;
    expect(created.spreadsheetUrl).toBe(`https://docs.google.com/spreadsheets/d/${id}/edit`);
    expect(created.sheets[0]?.properties.title).toBe('Attendees');
    // Header row, then the hidden sync column.
    expect(
      call(a, {
        method: 'PUT',
        path: values(id, 'Attendees!A1'),
        query: { valueInputOption: 'RAW' },
        body: { range: 'Attendees!A1', majorDimension: 'ROWS', values: [['Name', 'Email', 'Yayatoh sync']] },
      }).body,
    ).toMatchObject({ updatedRange: 'Attendees!A1:C1', updatedCells: 3 });
    const hide = (sheetId: number) =>
      call(a, {
        method: 'POST',
        path: `/v4/spreadsheets/${id}:batchUpdate`,
        body: {
          requests: [
            {
              updateDimensionProperties: {
                range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
                properties: { hiddenByUser: true },
                fields: 'hiddenByUser',
              },
            },
          ],
        },
      });
    expect(hide(created.sheets[0]?.properties.sheetId as number).status).toBe(200);
    expect(hide(999).status).toBe(400);
    expect(sheetsRemoteList(a)).toEqual([{ id, title: 'Gala · attendees', headers: ['Name', 'Email'] }]);
    // Appends go below the table; Google echoes the range it wrote.
    const append = (row: string[]) =>
      call(a, {
        method: 'POST',
        path: values(id, 'Attendees!A1', ':append'),
        query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
        body: { values: [row] },
        idempotencyKey: 'not-replayed',
      }).body as { updates: { updatedRange: string } };
    expect(append(['Ada', 'ada@x.test']).updates.updatedRange).toBe('Attendees!A2:B2');
    expect(append(['Ada', 'ada@x.test']).updates.updatedRange).toBe('Attendees!A3:B3');
    // A bounded update must fit its range.
    const put = (range: string, rows: string[][]) =>
      call(a, {
        method: 'PUT',
        path: values(id, range),
        query: { valueInputOption: 'RAW' },
        body: { values: rows },
      });
    expect(put('Attendees!A3:B3', [['Grace', 'grace@x.test']]).status).toBe(200);
    expect(put('Attendees!A3:B3', [['Grace', 'grace@x.test', 'x']]).status).toBe(400);
    // Trailing empty cells and rows are left out; an empty range has no `values`.
    expect(put('Attendees!B2', [['']]).status).toBe(200);
    const read = (range: string) =>
      call(a, { method: 'GET', path: values(id, range), query: { majorDimension: 'ROWS' } }).body;
    expect(read('Attendees!A1:Z')).toMatchObject({
      majorDimension: 'ROWS',
      values: [['Name', 'Email', 'Yayatoh sync'], ['Ada'], ['Grace', 'grace@x.test']],
    });
    expect(read('Attendees!A9:Z')).not.toHaveProperty('values');
    // Errors: no valueInputOption, an unknown tab or spreadsheet, an invented path.
    expect(
      call(a, { method: 'PUT', path: values(id, 'Attendees!A1'), body: { values: [['x']] } }).status,
    ).toBe(400);
    expect(call(a, { method: 'GET', path: values(id, 'Nope!A1:Z') }).status).toBe(400);
    expect(call(a, { method: 'GET', path: values('nope', 'Attendees!A1:Z') }).status).toBe(404);
    expect(call(a, { method: 'GET', path: `/v4/spreadsheets/${id}/rows` }).status).toBe(404);
    expect(call(a, { method: 'PATCH', path: `/v4/spreadsheets/${id}/rows/r1`, body: {} }).status).toBe(404);
    expect(call(a, { method: 'GET', path: '/v4/spreadsheets' }).status).toBe(405);
  });
});

describe('the Sheets connector against the fake', () => {
  const send = googleSheetsConnector.objects[0]?.push?.send;
  const list = googleSheetsConnector.objects[0]?.pull?.list;
  const setup = async () => {
    const a = account(googleSheetsFakeProvider.seed());
    const client = {
      request: async (req: Parameters<typeof googleSheetsFakeProvider.handle>[1]) => {
        a.log.push({ method: req.method, path: req.path, idempotencyKey: req.idempotencyKey ?? null });
        const res = googleSheetsFakeProvider.handle(a, req, 't');
        if (res.status < 200 || res.status > 299) throw new Error(`http_${res.status}`);
        return res;
      },
    };
    const created = (
      await client.request({
        method: 'POST',
        path: '/v4/spreadsheets',
        body: { properties: { title: 'T' }, sheets: [{ properties: { title: 'Attendees' } }] },
      })
    ).body as { spreadsheetId: string };
    const sid = created.spreadsheetId;
    // Columns reordered against SHEET_COLUMNS: mapped by label.
    await client.request({
      method: 'PUT',
      path: `/v4/spreadsheets/${sid}/values/${encodeURIComponent('Attendees!A1')}`,
      query: { valueInputOption: 'RAW' },
      body: { values: [['Email', 'Name', 'Labels', 'Status', 'Yayatoh sync']] },
    });
    const io = (now: Date) => ({
      client,
      origin: 'yayatoh:c1',
      now,
      scope: { links: [{ eventId: 'e1', spreadsheetId: sid }] },
      read: async () => {
        throw new Error('no db');
      },
    });
    const local = { id: 'a1', updatedAt: new Date(), fields: { event_id: 'e1' } };
    return { a, sid, io, local };
  };

  it('appends once per idempotency key, updates its row, and reads people’s rows and edits', async () => {
    if (!send || !list) throw new Error('sides');
    const { a, sid, io, local } = await setup();
    const t1 = new Date('2026-10-01T10:00:00Z');
    const values = { name: 'Ada', email: 'ada@x.test', labels: '', status: 'active' };
    const first = await send(io(t1), { externalId: null, values, idempotencyKey: 'k1', local });
    // A retry of the same write (the response was lost) finds the row instead of appending again.
    expect(await send(io(t1), { externalId: null, values, idempotencyKey: 'k1', local })).toEqual(first);
    expect(sheetsRemoteRows(a, sid)).toHaveLength(1);
    expect(first.externalId).toMatch(new RegExp(`^${sid}:r[A-Za-z0-9]{15}$`));
    const rowId = first.externalId.split(':')[1] as string;
    expect(rowRecordId(sid, rowId)).toBe(first.externalId);
    expect(sheetsRemoteRows(a, sid)[0]).toMatchObject({
      rowId,
      rev: 1,
      origin: 'yayatoh:c1',
      updatedAt: t1.toISOString(),
      values,
    });
    // The update lands in the same row with the next revision.
    const second = await send(io(t1), {
      externalId: first.externalId,
      values: { ...values, labels: 'vip' },
      idempotencyKey: 'k2',
      local,
    });
    expect(second).toEqual({ externalId: first.externalId, version: '2' });
    expect(sheetsRemoteRows(a, sid)).toHaveLength(1);
    expect(sheetsRemoteRows(a, sid)[0]?.values.labels).toBe('vip');
    // Only real endpoints were called, on paths the port proxies (no query string in a path).
    expect(a.log.every((l) => providerPath(l.path))).toBe(true);
    expect(new Set(a.log.map((l) => `${l.method} ${l.path.replace(sid, '{id}')}`))).toEqual(
      new Set([
        'POST /v4/spreadsheets',
        'PUT /v4/spreadsheets/{id}/values/Attendees!A1',
        'GET /v4/spreadsheets/{id}/values/Attendees!A1%3AZ',
        'POST /v4/spreadsheets/{id}/values/Attendees!A1:append',
        'PUT /v4/spreadsheets/{id}/values/Attendees!A2%3AE2',
      ]),
    );

    // A person edits our row and types in another: the read stamps both (ids hold from then on).
    sheetsRemoteEdit(a, sid, rowId, { name: 'Ada L.' });
    sheetsRemoteAdd(a, sid, { name: 'Walk-in', email: 'walk@x.test' });
    const t2 = new Date('2026-10-01T11:00:00Z');
    const page = await list(io(t2), null);
    expect(page.hasMore).toBe(false);
    expect(page.records).toHaveLength(2);
    expect(page.records[0]).toMatchObject({
      id: first.externalId,
      version: '3',
      origin: null,
      updatedAt: t2,
      fields: { name: 'Ada L.' },
    });
    const walkIn = page.records[1];
    expect(walkIn).toMatchObject({
      version: '1',
      origin: null,
      updatedAt: t2,
      fields: { email: 'walk@x.test' },
    });
    // Read again later: nothing changed, so the same ids, revisions and times.
    const again = await list(io(new Date('2026-10-01T12:00:00Z')), null);
    expect(again.records).toEqual(page.records);
    // Deleting a row removes it from the read (the engine flags its link; nothing here deletes).
    expect(sheetsRemoteDelete(a, sid, rowId)).toBe(true);
    expect((await list(io(t2), null)).records.map((r) => r.id)).toEqual([walkIn?.id]);
    // A write for a row that is gone appends a new one.
    const back = await send(io(t2), { externalId: first.externalId, values, idempotencyKey: 'k3', local });
    expect(back.externalId).not.toBe(first.externalId);
    expect(back.version).toBe('1');
  });
});
