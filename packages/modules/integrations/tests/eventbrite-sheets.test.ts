import { describe, expect, it } from 'vitest';
import type { FakeAccount } from '../src/auth/fake.ts';
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
  sheetsRemoteDelete,
  sheetsRemoteEdit,
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
  it('creates a sheet with headers, appends and patches rows once per Idempotency-Key', () => {
    const a = account(googleSheetsFakeProvider.seed());
    const created = googleSheetsFakeProvider.handle(
      a,
      {
        method: 'POST',
        path: '/v4/spreadsheets',
        body: { properties: { title: 'Gala · attendees' }, headers: [{ key: 'name', label: 'Name' }] },
        idempotencyKey: 'k0',
      },
      't',
    ).body as { spreadsheetId: string };
    const id = created.spreadsheetId;
    const append = (key: string) =>
      googleSheetsFakeProvider.handle(
        a,
        {
          method: 'POST',
          path: `/v4/spreadsheets/${id}/rows`,
          body: { values: { name: 'Ada', secret: 'dropped' }, origin: 'yayatoh:c' },
          idempotencyKey: key,
        },
        't',
      ).body as { rowId: string; rev: number };
    const r1 = append('k1');
    expect(append('k1')).toEqual(r1);
    expect(sheetsRemoteRows(a, id)).toHaveLength(1);
    expect(sheetsRemoteRows(a, id)[0]).toMatchObject({
      values: { name: 'Ada' },
      origin: 'yayatoh:c',
      rev: 1,
    });
    // A person's edit carries no origin and bumps the revision.
    sheetsRemoteEdit(a, id, r1.rowId, { name: 'Ada L.' });
    expect(sheetsRemoteRows(a, id)[0]).toMatchObject({ values: { name: 'Ada L.' }, origin: null, rev: 2 });
    expect(sheetsRemoteDelete(a, id, r1.rowId)).toBe(true);
    expect(sheetsRemoteRows(a, id)).toEqual([]);
    expect(
      googleSheetsFakeProvider.handle(
        a,
        { method: 'PATCH', path: `/v4/spreadsheets/${id}/rows/r1`, body: {} },
        't',
      ).status,
    ).toBe(404);
    expect(
      googleSheetsFakeProvider.handle(a, { method: 'GET', path: '/v4/spreadsheets/nope/rows' }, 't').status,
    ).toBe(404);
    expect(rowRecordId(id, 'r7')).toBe(`${id}:r7`);
  });
});
