import { randomBytes } from 'node:crypto';
import { addGuestCommand, getAttendeeQuery } from '@yayatoh/attendees';
import { bearerSessions, createAuth, memoryMailer } from '@yayatoh/auth';
import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { fakePaymentProvider } from '@yayatoh/payments';
import { publishEventLayoutCommand, setEventLayoutCommand } from '@yayatoh/seating';
import { addMemberCommand, createApiKeyCommand } from '@yayatoh/tenancy';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1, type V1Deps } from '../src/index.ts';

/**
 * M1.13d: the M1.8 bulk actions on /v1. The same commands as the console, so the same
 * permissions (key scopes, roles), entitlements, idempotency, audit and tenant isolation.
 */
const secret = randomBytes(32).toString('hex');
const auth = createAuth({ baseURL: 'http://localhost:4000', secret, mailer: memoryMailer().mailer });
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
const deps: V1Deps = {
  ports,
  sessions: () => bearerSessions(auth),
  payments: () => payments,
  telemetry: false,
};
const app = new Hono();
app.route('/v1', createV1(deps));

const RUN = randomBytes(4).toString('hex');
const password = 'correct horse battery';
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let readOnlyKey: string;
let managerToken: string;
let viewerToken: string;
/** name → attendee id */
const who: Record<string, string> = {};
const row = buildRow({ label: 'A', count: 6, x: 100, y: 100 });

type Json = Record<string, unknown>;
const idem = () => ({ 'idempotency-key': `bulk-${randomBytes(8).toString('hex')}` });
async function call(method: string, path: string, token?: string, bodyJson?: unknown, headers: Json = {}) {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(bodyJson !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(headers as Record<string, string>),
    },
    body: bodyJson === undefined ? undefined : JSON.stringify(bodyJson),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
}
const bulk = (kind: string, org = a) => `/orgs/${org.org.slug}/events/${eventId}/bulk/${kind}`;
const op = (kind: string, id: string, org = a) => `/orgs/${org.org.slug}/bulk/${kind}/${id}`;

async function labelsOf(name: string): Promise<string[]> {
  const r = await executeQuery(getAttendeeQuery, { eventId, attendeeId: who[name] }, a.ctx(), ports);
  return [...r.labels].sort();
}

async function session(name: string, role: 'viewer' | 'manager') {
  const email = `${name}-${RUN}@bulk.test`;
  const r = await auth.api.signUpEmail({ body: { email, password, name } });
  await executeCommand(addMemberCommand, { userId: r.user.id, role }, a.ctx(), ports);
  const login = await call('POST', '/auth/login', undefined, { email, password });
  return String(login.body.token);
}

async function guest(name: string) {
  who[name] = (
    await executeCommand(
      addGuestCommand,
      { eventId, name, email: `${name.toLowerCase()}.${RUN}@bulk.test` },
      a.ctx(),
      ports,
    )
  ).id;
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: `Bulk API ${RUN}`,
        timezone: 'UTC',
        startsAt: '2029-07-01T18:00:00Z',
        endsAt: '2029-07-01T22:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  const ga = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'GA', priceMinor: 0, quantityTotal: 50, maxPerOrder: 10 },
    a.ctx(),
    ports,
  );
  await executeCommand(
    setEventLayoutCommand,
    { eventId, doc: { version: 1, width: 800, height: 400, items: [row] } },
    a.ctx(),
    ports,
  );
  await executeCommand(publishEventLayoutCommand, { eventId }, a.ctx(), ports);
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  // Two free tickets (Ada, Bea) and three guests without one (Gus, Hal, Ivy).
  for (const name of ['Ada', 'Bea']) {
    const r = await executeCommand(
      startCheckoutCommand,
      {
        eventId,
        items: [{ ticketTypeId: ga.id, quantity: 1 }],
        buyer: { email: `${name.toLowerCase()}.${RUN}@bulk.test`, name },
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    const detail = await orderByManageToken(r.manageToken);
    const attendeeId = (
      await withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute<{ id: string }>(
          sql`select id from attendees.attendees where ticket_id = ${detail?.tickets[0]?.id ?? null}`,
        ),
      )
    )[0]?.id;
    who[name] = attendeeId as string;
  }
  for (const name of ['Gus', 'Hal', 'Ivy']) await guest(name);
  readOnlyKey = (
    await executeCommand(
      createApiKeyCommand,
      { name: 'Read only', scopes: ['org:read', 'events:read', 'orders:read', 'attendees:read'] },
      a.ctx(),
      ports,
    )
  ).key;
  managerToken = await session('manager', 'manager');
  viewerToken = await session('viewer', 'viewer');
});
afterAll(closePools);

describe('/v1 bulk actions', () => {
  it('labels by ids with an API key: 202, done inline, audited as the key; undo once restores', async () => {
    const key = idem();
    const started = await call(
      'POST',
      bulk('labels'),
      a.apiKey,
      { selection: { ids: [who.Gus, who.Hal] }, add: ['VIP', ' Press  Pass '] },
      { ...key, 'x-request-id': `bulk-labels-${RUN}` },
    );
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({
      kind: 'labels',
      eventId,
      status: 'done',
      total: 2,
      processed: 2,
      succeeded: 2,
      failed: 0,
      failures: [],
      warnings: [],
    });
    expect(started.body.undoUntil).toEqual(expect.any(String));
    // An allowlist: no params, item ids, file or requester.
    expect(Object.keys(started.body).sort()).toEqual(
      [
        'createdAt',
        'eventId',
        'failed',
        'failures',
        'finishedAt',
        'id',
        'kind',
        'processed',
        'status',
        'succeeded',
        'total',
        'undoUntil',
        'undone',
        'warnings',
      ].sort(),
    );
    expect(await labelsOf('Gus')).toEqual(['Press Pass', 'VIP']);
    const id = String(started.body.id);

    const [audit] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ actor: string; data: Json; request_id: string }>(
        sql`select actor, data, request_id from platform.audit_events where action = 'bulk.start' and target_id = ${id}`,
      ),
    );
    expect(audit?.actor).toMatch(/^api_key:/);
    expect(audit?.request_id).toBe(`bulk-labels-${RUN}`);
    expect(audit?.data).toMatchObject({ action: 'attendees.label', eventId, total: 2 });

    const status = await call('GET', op('labels', id), a.apiKey);
    expect(status.status).toBe(200);
    expect(status.body.id).toBe(id);
    // Another kind's path doesn't find it.
    expect((await call('GET', op('emails', id), a.apiKey)).status).toBe(404);

    const undone = await call('POST', `${op('labels', id)}/undo`, a.apiKey, undefined, idem());
    expect(undone.status).toBe(202);
    expect(undone.body).toMatchObject({ status: 'undone', undone: 2, undoUntil: null });
    expect(await labelsOf('Gus')).toEqual([]);
    const again = await call('POST', `${op('labels', id)}/undo`, a.apiKey, undefined, idem());
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('invalid_state');
  });

  it('one operation per Idempotency-Key: a retry replays it, another body is 422, none is 400', async () => {
    const key = idem();
    const body = { selection: { filter: { search: 'Ivy' } }, add: ['retry'] };
    const first = await call('POST', bulk('labels'), a.apiKey, body, key);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ status: 'done', total: 1, succeeded: 1 });
    const retry = await call('POST', bulk('labels'), a.apiKey, body, key);
    expect(retry.status).toBe(202);
    expect(retry.body.id).toBe(first.body.id);
    const [n] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.bulk_operations where event_id = ${eventId} and params->'add' ? 'retry'`,
      ),
    );
    expect(n?.n).toBe(1);
    const reused = await call('POST', bulk('labels'), a.apiKey, { ...body, add: ['other'] }, key);
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe('idempotency_key_reused');
    const missing = await call('POST', bulk('labels'), a.apiKey, body);
    expect(missing.status).toBe(400);
    expect(await labelsOf('Ivy')).toEqual(['retry']);
  });

  it('resends tickets: guests without one fail no_ticket; one resend event per chunk', async () => {
    const r = await call(
      'POST',
      bulk('ticket-resends'),
      a.apiKey,
      { selection: { ids: [who.Ada, who.Bea, who.Gus] } },
      idem(),
    );
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ status: 'done', total: 3, succeeded: 2, failed: 1 });
    expect(r.body.failures).toEqual([{ attendeeId: who.Gus, code: 'no_ticket' }]);
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ payload: { ticketIds: string[] } }>(
        sql`select payload from platform.domain_events where type = 'ticket.resend_requested' and aggregate_id = ${String(r.body.id)}`,
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.ticketIds).toHaveLength(2);
  });

  it('emails attendees; the message body never reaches the audit row', async () => {
    const r = await call(
      'POST',
      bulk('emails'),
      a.apiKey,
      { selection: { ids: [who.Gus] }, subject: 'Doors at 6', body: 'Secret door code 4321' },
      idem(),
    );
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ status: 'done', succeeded: 1 });
    const [audit] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ data: Json }>(
        sql`select data from platform.audit_events where action = 'bulk.start' and target_id = ${String(r.body.id)}`,
      ),
    );
    expect(JSON.stringify(audit?.data)).not.toContain('4321');
    // Validation of the wire body.
    const bad = await call('POST', bulk('emails'), a.apiKey, { selection: { ids: [who.Gus] } }, idem());
    expect(bad.status).toBe(400);
  });

  it('seats guests in the best seats and undoes it', async () => {
    const r = await call(
      'POST',
      bulk('seat-assignments'),
      a.apiKey,
      { selection: { ids: [who.Hal, who.Ivy] }, target: { kind: 'best' } },
      idem(),
    );
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ kind: 'seat-assignments', status: 'done', succeeded: 2 });
    const seated = async () =>
      (
        await withTenant(systemCtx(a.org.id), (tx) =>
          tx.execute<{ n: number }>(
            sql`select count(*)::int as n from seating.seat_assignments where event_id = ${eventId}`,
          ),
        )
      )[0]?.n;
    expect(await seated()).toBe(2);
    const undone = await call(
      'POST',
      `${op('seat-assignments', String(r.body.id))}/undo`,
      a.apiKey,
      undefined,
      idem(),
    );
    expect(undone.body).toMatchObject({ status: 'undone' });
    expect(await seated()).toBe(0);
  });

  it('cancels tickets by explicit ids only; no money moves; not undoable', async () => {
    const byFilter = await call(
      'POST',
      bulk('ticket-cancellations'),
      a.apiKey,
      { selection: { filter: { search: 'Bea' } } },
      idem(),
    );
    expect(byFilter.status).toBe(400);
    const r = await call(
      'POST',
      bulk('ticket-cancellations'),
      a.apiKey,
      { selection: { ids: [who.Bea] } },
      idem(),
    );
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({
      kind: 'ticket-cancellations',
      status: 'done',
      succeeded: 1,
      undoUntil: null,
    });
    const [t] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ status: string }>(
        sql`select t.status from ticketing.tickets t join attendees.attendees x on x.ticket_id = t.id where x.id = ${who.Bea}`,
      ),
    );
    expect(t?.status).toBe('void');
    // No undo route for cancellations.
    expect(
      (
        await call(
          'POST',
          `${op('ticket-cancellations', String(r.body.id))}/undo`,
          a.apiKey,
          undefined,
          idem(),
        )
      ).status,
    ).toBe(400);
  });

  it('respects scopes and roles: read-only keys and viewers are 403; managers label but cannot cancel', async () => {
    const body = { selection: { ids: [who.Gus] }, add: ['nope'] };
    for (const [kind, payload] of [
      ['labels', body],
      ['emails', { selection: { ids: [who.Gus] }, subject: 's', body: 'b' }],
      ['seat-assignments', { selection: { ids: [who.Gus] }, target: { kind: 'best' } }],
      ['ticket-resends', { selection: { ids: [who.Gus] } }],
      ['ticket-cancellations', { selection: { ids: [who.Gus] } }],
    ] as const) {
      const r = await call('POST', bulk(kind), readOnlyKey, payload, idem());
      expect({ kind, status: r.status, code: r.body.code }).toEqual({ kind, status: 403, code: 'forbidden' });
    }
    expect((await call('POST', bulk('labels'), viewerToken, body, idem())).status).toBe(403);
    const managed = await call('POST', bulk('labels'), managerToken, { ...body, add: ['manager'] }, idem());
    expect(managed.status).toBe(202);
    const [audit] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ actor: string }>(
        sql`select actor from platform.audit_events where action = 'bulk.start' and target_id = ${String(managed.body.id)}`,
      ),
    );
    expect(audit?.actor).toMatch(/^user:/);
    const cancel = await call(
      'POST',
      bulk('ticket-cancellations'),
      managerToken,
      { selection: { ids: [who.Ada] } },
      idem(),
    );
    expect(cancel.status).toBe(403);
    // Reading an operation needs its kind's scope too.
    expect((await call('GET', op('labels', String(managed.body.id)), readOnlyKey)).status).toBe(403);
    // No credential: 401.
    expect((await call('POST', bulk('labels'), undefined, body, idem())).status).toBe(401);
  });

  it('isolates tenants: another org neither sees nor starts on this org’s event or operations', async () => {
    const mine = await call(
      'POST',
      bulk('labels'),
      a.apiKey,
      { selection: { ids: [who.Gus] }, add: ['iso'] },
      idem(),
    );
    const id = String(mine.body.id);
    // B's key on A's path: A doesn't exist for it.
    expect((await call('GET', op('labels', id), b.apiKey)).status).toBe(404);
    expect(
      (await call('POST', bulk('labels'), b.apiKey, { selection: { ids: [who.Gus] }, add: ['x'] }, idem()))
        .status,
    ).toBe(404);
    // B's key on B's path with A's ids, event and operation: not found under B's RLS.
    const onB = `/orgs/${b.org.slug}/events/${eventId}/bulk/labels`;
    expect(
      (await call('POST', onB, b.apiKey, { selection: { ids: [who.Gus] }, add: ['x'] }, idem())).status,
    ).toBe(404);
    const filterOnB = await call('POST', onB, b.apiKey, { selection: { filter: {} }, add: ['x'] }, idem());
    expect(filterOnB.status).toBe(400);
    expect((await call('GET', op('labels', id, b), b.apiKey)).status).toBe(404);
    expect((await call('POST', `${op('labels', id, b)}/undo`, b.apiKey, undefined, idem())).status).toBe(404);
    expect(await labelsOf('Gus')).toContain('iso');
  });

  it('needs the module: seat assignments are refused where seating is off', async () => {
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'seating', effect: 'revoke', reason: 'test' },
      systemCtx(b.org.id),
      ports,
    );
    try {
      const r = await call(
        'POST',
        `/orgs/${b.org.slug}/events/${b.event.id}/bulk/seat-assignments`,
        b.apiKey,
        { selection: { filter: {} }, target: { kind: 'best' } },
        idem(),
      );
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('module_not_enabled');
    } finally {
      await executeCommand(
        setEntitlementOverrideCommand,
        { moduleKey: 'seating', effect: 'grant', reason: 'test' },
        systemCtx(b.org.id),
        ports,
      );
    }
  });
});
