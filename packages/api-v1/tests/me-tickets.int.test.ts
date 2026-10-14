import { randomBytes } from 'node:crypto';
import { bearerSessions, createAuth, memoryMailer } from '@yayatoh/auth';
import { createCheckpointCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  guestOrders,
  orderByManageToken,
  setRefundPolicyCommand,
  startCheckoutCommand,
} from '@yayatoh/orders';
import { fakePaymentProvider } from '@yayatoh/payments';
import { signLinkToken } from '@yayatoh/platform';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import {
  CLAIM_PURPOSE,
  createClaimLinksCommand,
  createTicketTypeCommand,
  holderContext,
  issueHolderLinkTx,
  updateTicketTypeCommand,
} from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1 } from '../src/index.ts';

/**
 * M7.2b: `/v1/me/tickets`, `/v1/me/orders`, transfers, refund requests, wallet passes and claims.
 * A person is their session's verified email; these tests read and write as real signed-in people
 * across both fixture orgs and check that nobody ever sees or changes a ticket or order that is
 * not bought by or held by their address.
 */
const secret = randomBytes(32).toString('hex');
const auth = createAuth({ baseURL: 'http://localhost:4000', secret, mailer: memoryMailer().mailer });
const sessions = bearerSessions(auth);
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
const app = new Hono().route(
  '/v1',
  createV1({
    ports,
    sessions: () => sessions,
    payments: () => payments,
    telemetry: false,
    publicOrigin: 'https://app.example.test',
    mobile: { baseUrls: { api: 'https://api.example.test', web: 'https://web.example.test' } },
  }),
);
const admin = adminClient();
const password = 'correct horse battery';
const suffix = randomBytes(4).toString('hex');
const STARTS = '2027-03-01T19:00:00Z';
const ENDS = '2027-03-01T23:00:00Z';

let a: OrgFixture;
let b: OrgFixture;
let eventA: { id: string; typeId: string; slug: string };
let eventB: { id: string; typeId: string };
let pastB: { id: string; typeId: string };
let entranceName: string;

// biome-ignore lint/suspicious/noExplicitAny: wire JSON read property by property in assertions
type Json = Record<string, any>;
async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    text,
    body: (text ? JSON.parse(text) : null) as Json,
  };
}
const keyed = () => ({ 'idempotency-key': `k-${uuidv7()}` });

interface Person {
  email: string;
  userId: string;
  token: string;
}
async function person(name: string, verified = true, email?: string): Promise<Person> {
  const address = email ?? `${name}-${suffix}@example.test`;
  const r = await auth.api.signUpEmail({ body: { email: address, password, name } });
  await admin`update auth.users set email_verified = ${verified} where id = ${r.user.id}`;
  const login = await call('POST', '/auth/login', undefined, { email: address, password });
  return { email: address, userId: r.user.id, token: String(login.body.token) };
}

const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>, org: OrgFixture) =>
  withTenant(systemCtx(org.org.id), (tx) => tx.execute<T>(query));

interface Bought {
  orderId: string;
  token: string;
  ticketIds: string[];
}
/** A paid order of `quantity` tickets bought by `email` in `org`'s event (the fake provider). */
async function buy(
  org: OrgFixture,
  event: { id: string; typeId: string },
  email: string,
  quantity = 1,
): Promise<Bought> {
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId: event.id,
      items: [{ ticketTypeId: event.typeId, quantity }],
      buyer: { email, name: `Buyer ${email.split('@')[0]}` },
    },
    createCtx({ orgId: org.org.id }),
    ports,
  );
  const pi = `fakepi_me_${c.order.id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
    createCtx({ orgId: org.org.id }),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_me_${c.order.id}`,
      type: 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor: c.order.totalMinor,
      currency: 'USD',
      orgId: org.org.id,
      orderId: c.order.id,
    },
    systemCtx(org.org.id),
    ports,
  );
  const ticketIds = (
    await q<{ id: string }>(
      sql`select id from ticketing.tickets where order_id = ${c.order.id} order by serial`,
      org,
    )
  ).map((r) => r.id);
  return { orderId: c.order.id, token: c.manageToken, ticketIds };
}

async function mkEvent(org: OrgFixture, name: string, startsAt = STARTS, endsAt = ENDS) {
  const e = await executeCommand(
    createEventCommand,
    { name, timezone: 'America/Chicago', startsAt, endsAt },
    org.ctx(),
    ports,
  );
  const t = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'General', priceMinor: 5000, quantityTotal: 100, maxPerOrder: 10 },
    org.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, org.ctx(), ports);
  await executeCommand(
    setRefundPolicyCommand,
    { eventId: e.id, kind: 'until', daysBefore: 7, retainedMinor: 100 },
    org.ctx(),
    ports,
  );
  return { id: e.id, typeId: t.id, slug: e.slug };
}

const setType = (org: OrgFixture, typeId: string, patch: Record<string, unknown>) =>
  executeCommand(updateTicketTypeCommand, { ticketTypeId: typeId, ...patch }, org.ctx(), ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  eventA = await mkEvent(a, `Me Night ${suffix}`);
  eventB = await mkEvent(b, `Me Gala ${suffix}`, '2027-04-10T19:00:00Z', '2027-04-10T23:00:00Z');
  pastB = await mkEvent(b, `Me Retro ${suffix}`);
  entranceName = `North gate ${suffix}`;
  await executeCommand(
    createCheckpointCommand,
    { eventId: eventA.id, name: entranceName, kind: 'entrance' },
    a.ctx(),
    ports,
  );
  await executeCommand(
    createCheckpointCommand,
    { eventId: eventA.id, name: `VIP lounge ${suffix}`, kind: 'zone', ticketTypeIds: [eventA.typeId] },
    a.ctx(),
    ports,
  );
  const crew = await executeCommand(
    createTicketTypeCommand,
    { eventId: eventA.id, name: 'Crew', priceMinor: 0, quantityTotal: 5, visibility: 'hidden' },
    a.ctx(),
    ports,
  );
  await executeCommand(
    createCheckpointCommand,
    { eventId: eventA.id, name: `Crew zone ${suffix}`, kind: 'zone', ticketTypeIds: [crew.id] },
    a.ctx(),
    ports,
  );
  await admin`update tenancy.organizations set brand_color = '#aa3300' where id = ${a.org.id}`;
});
afterAll(async () => {
  await admin.end();
  await closePools();
});

describe('who may call', () => {
  const reads = ['/me/tickets', '/me/orders', `/me/tickets/${uuidv7()}`, `/me/orders/${uuidv7()}`];

  it('needs a user session with a verified email: no credential 401, API key 401, unverified 403', async () => {
    const unverified = await person('unverified', false);
    for (const path of reads) {
      expect((await call('GET', path)).status, path).toBe(401);
      expect((await call('GET', path, a.apiKey)).status, path).toBe(401);
      const r = await call('GET', path, unverified.token);
      expect(r.status, path).toBe(403);
      expect(r.body).toMatchObject({ code: 'forbidden', details: { reason: 'email_unverified' } });
    }
    const writes: [string, string, unknown][] = [
      ['POST', `/me/tickets/${uuidv7()}/transfers`, { toName: 'X', toEmail: 'x@example.test' }],
      ['DELETE', `/me/tickets/${uuidv7()}/transfers/${uuidv7()}`, undefined],
      ['GET', `/me/tickets/${uuidv7()}/wallet?platform=apple`, undefined],
      ['POST', `/me/orders/${uuidv7()}/refund-requests`, {}],
      ['GET', '/claims/some-claim-token-value', undefined],
      ['POST', '/claims/some-claim-token-value', {}],
    ];
    for (const [method, path, body] of writes) {
      expect((await call(method, path, undefined, body, keyed())).status, `${method} ${path}`).toBe(401);
      expect((await call(method, path, a.apiKey, body, keyed())).status, `${method} ${path}`).toBe(401);
      const r = await call(method, path, unverified.token, body, keyed());
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.body.details).toMatchObject({ reason: 'email_unverified' });
    }
  });

  it('an unverified account that shares a buyer’s email address reads nothing', async () => {
    const email = `squatter-${suffix}@example.test`;
    await buy(a, eventA, email);
    const squatter = await person('squatter', false);
    expect(squatter.email).toBe(email);
    expect((await call('GET', '/me/tickets', squatter.token)).status).toBe(403);
    expect((await call('GET', '/me/orders', squatter.token)).status).toBe(403);
  });
});

describe('GET /v1/me/tickets', () => {
  let rae: Person;
  let raeA: Bought;
  let raeB: Bought;
  let raePast: Bought;

  beforeAll(async () => {
    // Bought in mixed case: the address is the key, not its spelling.
    rae = await person('rae', true, `Rae-${suffix}@Example.test`);
    raeA = await buy(a, eventA, rae.email, 2);
    raeB = await buy(b, eventB, rae.email, 1);
    raePast = await buy(b, pastB, rae.email, 1);
    // The retro event is over: move it into the past after the sale.
    await admin`update events.events set starts_at = '2024-05-01T19:00:00Z', ends_at = '2024-05-01T23:00:00Z' where id = ${pastB.id}`;
  });

  it('lists upcoming tickets soonest first, across organizers, with no codes', async () => {
    const r = await call('GET', '/me/tickets', rae.token);
    expect(r.status).toBe(200);
    const data = r.body.data as Json[];
    expect(data.map((t) => t.event.name)).toEqual([
      expect.stringContaining('Me Night'),
      expect.stringContaining('Me Night'),
      expect.stringContaining('Me Gala'),
    ]);
    expect(data.map((t) => t.id).sort()).toEqual([...raeA.ticketIds, ...raeB.ticketIds].sort());
    expect(data[0]).toMatchObject({
      status: 'active',
      rev: 0,
      ticketTypeName: 'General',
      organizerName: expect.any(String),
      pendingTransfer: false,
      accentColor: '#aa3300',
      event: { timezone: 'America/Chicago', startsAt: '2027-03-01T19:00:00.000Z' },
    });
    expect(r.text).not.toContain('qrCode');
    expect(r.body.nextCursor).toBeNull();
    expect(r.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('lists past tickets separately, latest first', async () => {
    const r = await call('GET', '/me/tickets?when=past', rae.token);
    expect((r.body.data as Json[]).map((t) => t.id)).toEqual(raePast.ticketIds);
    expect((await call('GET', '/me/tickets?when=soon', rae.token)).status).toBe(400);
  });

  it('pages with an opaque keyset cursor and never repeats or skips a ticket', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: Awaited<ReturnType<typeof call>> = await call(
        'GET',
        `/me/tickets?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        rae.token,
      );
      expect(r.status).toBe(200);
      seen.push(...(r.body.data as Json[]).map((t) => t.id));
      cursor = r.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen.sort()).toEqual([...raeA.ticketIds, ...raeB.ticketIds].sort());
    expect((await call('GET', '/me/tickets?cursor=not-a-cursor', rae.token)).status).toBe(400);
  });

  it('is exactly the tickets the web’s My tickets shows for this person (contract)', async () => {
    const web = new Set<string>();
    for (const o of await guestOrders(rae.email, null)) {
      const token = o.managePath.replace('/orders/', '');
      for (const t of (await orderByManageToken(token))?.tickets ?? []) web.add(t.id);
    }
    const mine = new Set<string>();
    for (const when of ['upcoming', 'past']) {
      const r = await call('GET', `/me/tickets?when=${when}&limit=100`, rae.token);
      for (const t of r.body.data as Json[]) mine.add(t.id);
    }
    expect([...mine].sort()).toEqual([...web].sort());
    expect(mine.size).toBe(4);
  });

  it('sends an ETag and answers 304 to If-None-Match', async () => {
    const first = await call('GET', '/me/tickets', rae.token);
    const etag = first.headers.get('etag') as string;
    expect(etag).toMatch(/^"[\w-]{32}"$/);
    const again = await call('GET', '/me/tickets', rae.token, undefined, { 'if-none-match': etag });
    expect(again.status).toBe(304);
    expect(again.text).toBe('');
  });

  it('a person with nothing sees an empty list', async () => {
    const nobody = await person('nobody-list');
    expect(await call('GET', '/me/tickets', nobody.token)).toMatchObject({
      status: 200,
      body: { data: [], nextCursor: null },
    });
  });
});

describe('GET /v1/me/tickets/{id}', () => {
  let sam: Person;
  let samA: Bought;

  beforeAll(async () => {
    sam = await person('sam');
    samA = await buy(a, eventA, sam.email, 1);
  });

  it('shows the QR code, short code, rev, seat, type, entrances, event, venue and branding', async () => {
    const id = samA.ticketIds[0] as string;
    const r = await call('GET', `/me/tickets/${id}`, sam.token);
    expect(r.status).toBe(200);
    const web = (await orderByManageToken(samA.token))?.tickets[0];
    expect(r.body).toMatchObject({
      id,
      orderId: samA.orderId,
      status: 'active',
      rev: 0,
      qrCode: web?.code,
      shortCode: web?.shortCode,
      seatLabel: null,
      ticketTypeName: 'General',
      ticketTypeId: eventA.typeId,
      holderName: `Buyer ${sam.email.split('@')[0]}`,
      date: null,
      event: {
        slug: eventA.slug,
        timezone: 'America/Chicago',
        startsAt: '2027-03-01T19:00:00.000Z',
        endsAt: '2027-03-01T23:00:00.000Z',
      },
      venue: null,
      branding: {
        accentColor: '#aa3300',
        logoUrl: expect.stringMatching(/^https:\/\/app\.example\.test\/media\//),
        poweredByVisible: expect.any(Boolean),
      },
    });
    expect(r.body.qrCode).toMatch(/^YY1/i);
    // The entrance and the zone that includes this type; the zone for other types is not shown.
    expect((r.body.checkpoints as Json[]).map((c) => [c.kind, c.name]).sort()).toEqual(
      [
        ['entrance', entranceName],
        ['zone', `VIP lounge ${suffix}`],
      ].sort(),
    );
    expect(r.body.transfer).toMatchObject({
      allowed: true,
      reason: null,
      feeMinor: 0,
      currency: 'USD',
      feeRequiresWeb: false,
      pendingTransferId: null,
    });
    expect(r.headers.get('etag')).toMatch(/^"/);
    const cached = await call('GET', `/me/tickets/${id}`, sam.token, undefined, {
      'if-none-match': r.headers.get('etag') as string,
    });
    expect(cached.status).toBe(304);
  });

  it('shows the transfer rules: not allowed, the cutoff, and a fee that is paid on the web', async () => {
    const id = samA.ticketIds[0] as string;
    await setType(a, eventA.typeId, { transfersAllowed: false });
    expect((await call('GET', `/me/tickets/${id}`, sam.token)).body.transfer).toMatchObject({
      allowed: false,
      reason: 'not_allowed',
    });
    await setType(a, eventA.typeId, {
      transfersAllowed: true,
      transferCutoffHours: 48,
      transferFeeMinor: 350,
    });
    expect((await call('GET', `/me/tickets/${id}`, sam.token)).body.transfer).toMatchObject({
      allowed: true,
      feeMinor: 350,
      feeRequiresWeb: true,
      deadline: '2027-02-27T19:00:00.000Z',
    });
    await setType(a, eventA.typeId, { transferCutoffHours: 8760 });
    expect((await call('GET', `/me/tickets/${id}`, sam.token)).body.transfer).toMatchObject({
      allowed: false,
      reason: 'deadline_passed',
    });
    await setType(a, eventA.typeId, { transferCutoffHours: null, transferFeeMinor: 0 });
  });

  it('is a 404 for a ticket that is not yours, in your org or another, or does not exist', async () => {
    const stranger = await person('stranger-detail');
    const other = await buy(b, eventB, `owner-${suffix}@example.test`);
    for (const id of [samA.ticketIds[0], other.ticketIds[0], uuidv7()] as string[])
      expect((await call('GET', `/me/tickets/${id}`, stranger.token)).status, id).toBe(404);
    // Sam holds a ticket in org A only: org B's ticket id is a 404 for Sam too.
    expect((await call('GET', `/me/tickets/${other.ticketIds[0]}`, sam.token)).status).toBe(404);
    expect((await call('GET', '/me/tickets/not-a-uuid', sam.token)).status).toBe(400);
  });

  it('never carries the buyer’s private data, manage links, payments or other holders', async () => {
    const r = await call('GET', `/me/tickets/${samA.ticketIds[0]}`, sam.token);
    const list = await call('GET', '/me/tickets', sam.token);
    for (const text of [r.text, list.text]) {
      expect(text).not.toContain(samA.token);
      expect(text).not.toMatch(
        /manage|buyerEmail|holderEmail|fakepi_|providerPayment|promoCode|@example\.test/i,
      );
    }
  });
});

describe('orders', () => {
  let kim: Person;
  let kimA: Bought;
  let kimB: Bought;

  beforeAll(async () => {
    kim = await person('kim');
    kimA = await buy(a, eventA, kim.email, 2);
    kimB = await buy(b, eventB, kim.email, 1);
  });

  it('lists the orders bought with the address, newest first, with keyset paging', async () => {
    const r = await call('GET', '/me/orders', kim.token);
    expect(r.status).toBe(200);
    expect((r.body.data as Json[]).map((o) => o.id)).toEqual([kimB.orderId, kimA.orderId]);
    expect(r.body.data[1]).toMatchObject({
      status: 'paid',
      tickets: 2,
      totalMinor: expect.any(Number),
      currency: 'USD',
      timezone: 'America/Chicago',
    });
    const first = await call('GET', '/me/orders?limit=1', kim.token);
    expect((first.body.data as Json[]).map((o) => o.id)).toEqual([kimB.orderId]);
    const second = await call(
      'GET',
      `/me/orders?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      kim.token,
    );
    expect((second.body.data as Json[]).map((o) => o.id)).toEqual([kimA.orderId]);
    expect(second.body.nextCursor).toBeNull();
    expect(r.text).not.toMatch(/managePath|\/orders\/[A-Za-z0-9_-]{40}/);
  });

  it('shows one order: lines, totals in minor units, the refund policy and the request status', async () => {
    const r = await call('GET', `/me/orders/${kimA.orderId}`, kim.token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: kimA.orderId,
      status: 'paid',
      currency: 'USD',
      subtotalMinor: 10000,
      discountMinor: 0,
      items: [
        { ticketTypeId: eventA.typeId, name: 'General', quantity: 2, unitAllInMinor: expect.any(Number) },
      ],
      refundPolicy: { kind: 'until', daysBefore: 7, retainedMinor: 100, timezone: 'America/Chicago' },
      refundRequest: { latest: null, canRequest: true, refusal: null },
      ticketIds: kimA.ticketIds,
      transferred: 0,
    });
    expect(r.body.totalMinor).toBeGreaterThanOrEqual(10000);
    expect(r.text).not.toMatch(/promoCode|buyerEmail|manage/i);
    const etag = r.headers.get('etag') as string;
    expect(
      (await call('GET', `/me/orders/${kimA.orderId}`, kim.token, undefined, { 'if-none-match': etag }))
        .status,
    ).toBe(304);
  });

  it('never shows someone else’s order, in either org', async () => {
    const stranger = await person('stranger-order');
    for (const id of [kimA.orderId, kimB.orderId, uuidv7()])
      expect((await call('GET', `/me/orders/${id}`, stranger.token)).status, id).toBe(404);
    expect((await call('GET', '/me/orders', stranger.token)).body.data).toEqual([]);
    // Kim bought in both orgs, so Kim sees both; the holder of a passed-on ticket sees no order.
    expect((await call('GET', `/me/orders/${kimB.orderId}`, kim.token)).status).toBe(200);
  });

  it('asks for a refund: validated, idempotent, one open request, and the policy decides', async () => {
    const order = await buy(a, eventA, kim.email, 2);
    const path = `/me/orders/${order.orderId}/refund-requests`;
    // Bad input.
    expect((await call('POST', path, kim.token, { ticketIds: ['nope'] }, keyed())).status).toBe(400);
    expect((await call('POST', path, kim.token, { message: 'x'.repeat(1001) }, keyed())).status).toBe(400);
    expect((await call('POST', path, kim.token, {})).status).toBe(400);
    // A ticket that is not one of mine.
    const foreign = await call('POST', path, kim.token, { ticketIds: [uuidv7()] }, keyed());
    expect(foreign.status).toBe(400);
    expect(foreign.body).toMatchObject({ code: 'validation_failed' });
    // Someone else's order.
    const stranger = await person('stranger-refund');
    expect((await call('POST', path, stranger.token, {}, keyed())).status).toBe(404);

    const headers = keyed();
    const body = { ticketIds: [order.ticketIds[0]], message: 'Cannot make it' };
    const made = await call('POST', path, kim.token, body, headers);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ status: 'open', tickets: 1, decidedAt: null, declineReason: null });
    // The same key replays the stored answer without a second request; a different body is refused.
    const replay = await call('POST', path, kim.token, body, headers);
    expect(replay).toMatchObject({ status: 201, body: made.body });
    expect((await call('POST', path, kim.token, { message: 'other' }, headers)).status).toBe(422);
    const [count] = await q<{ n: number }>(
      sql`select count(*)::int as n from orders.refund_requests where order_id = ${order.orderId}`,
      a,
    );
    expect(count?.n).toBe(1);
    // One open request per order.
    const second = await call('POST', path, kim.token, {}, keyed());
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'conflict', details: { reason: 'request_open' } });
    // The order now shows the request and why another cannot be made.
    expect((await call('GET', `/me/orders/${order.orderId}`, kim.token)).body.refundRequest).toMatchObject({
      latest: { status: 'open', tickets: 1 },
      canRequest: false,
      refusal: 'request_open',
    });
  });

  it('the refund policy is enforced by the command: no refunds, and a closed window', async () => {
    const order = await buy(a, eventA, kim.email, 1);
    const path = `/me/orders/${order.orderId}/refund-requests`;
    // The order keeps the terms it was bought under; a tighter policy only reaches later orders.
    await executeCommand(
      setRefundPolicyCommand,
      { eventId: eventA.id, kind: 'none', retainedMinor: 0 },
      a.ctx(),
      ports,
    );
    const later = await buy(a, eventA, kim.email, 1);
    const refused = await call('POST', `/me/orders/${later.orderId}/refund-requests`, kim.token, {}, keyed());
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'invalid_state', details: { reason: 'policy_no_refunds' } });
    expect((await call('GET', `/me/orders/${later.orderId}`, kim.token)).body.refundRequest).toMatchObject({
      canRequest: false,
      refusal: 'policy_no_refunds',
    });
    expect((await call('POST', path, kim.token, {}, keyed())).status).toBe(201);
    // Past the policy's window (the order was bought under "until 7 days before"): a request 3
    // days before the event is refused with the deadline, by the command, whatever the route says.
    const closed = await buy(a, eventA, kim.email, 1);
    await admin`update orders.orders set refund_policy_snapshot = ${JSON.stringify({ kind: 'until', daysBefore: 7, retainedMinor: 100 })}::jsonb where id = ${closed.orderId}`;
    await admin`update events.events set starts_at = now() + interval '3 days', ends_at = now() + interval '3 days 4 hours' where id = ${eventA.id}`;
    const late = await call('POST', `/me/orders/${closed.orderId}/refund-requests`, kim.token, {}, keyed());
    await admin`update events.events set starts_at = ${STARTS}, ends_at = ${ENDS} where id = ${eventA.id}`;
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ details: { reason: 'policy_window_closed' } });
    await executeCommand(
      setRefundPolicyCommand,
      { eventId: eventA.id, kind: 'until', daysBefore: 7, retainedMinor: 100 },
      a.ctx(),
      ports,
    );
  });
});

describe('transfers', () => {
  let tess: Person;
  let tessA: Bought;

  beforeAll(async () => {
    tess = await person('tess');
    tessA = await buy(a, eventA, tess.email, 3);
  });

  const start = (ticketId: string, token: string, body: unknown, headers = keyed()) =>
    call('POST', `/me/tickets/${ticketId}/transfers`, token, body, headers);

  it('validates the recipient and refuses a transfer to oneself', async () => {
    const id = tessA.ticketIds[0] as string;
    expect((await start(id, tess.token, { toName: '', toEmail: 'x@example.test' })).status).toBe(400);
    expect((await start(id, tess.token, { toName: 'Pat', toEmail: 'not-an-email' })).status).toBe(400);
    expect((await start(id, tess.token, { toName: 'Pat' })).status).toBe(400);
    expect(
      (
        await call('POST', `/me/tickets/${id}/transfers`, tess.token, {
          toName: 'P',
          toEmail: 'p@example.test',
        })
      ).status,
    ).toBe(400);
    const same = await start(id, tess.token, { toName: 'Me', toEmail: tess.email.toUpperCase() });
    expect(same.status).toBe(400);
    expect(same.body).toMatchObject({ code: 'validation_failed', details: { reason: 'same_holder' } });
  });

  it('starts a transfer, once per key; the ticket stays mine until it is claimed; cancelling is idempotent', async () => {
    const id = tessA.ticketIds[0] as string;
    const headers = keyed();
    const made = await start(
      id,
      tess.token,
      { toName: 'Pat Lee', toEmail: `pat-${suffix}@example.test` },
      headers,
    );
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      status: 'started',
      transferId: expect.any(String),
      feeMinor: 0,
      currency: 'USD',
      webUrl: null,
    });
    // The claim link's token is the recipient's; the sender's phone never holds it.
    expect(made.text).not.toMatch(/token|~/i);
    expect(
      await start(id, tess.token, { toName: 'Pat Lee', toEmail: `pat-${suffix}@example.test` }, headers),
    ).toMatchObject({
      status: 201,
      body: made.body,
    });
    const detail = await call('GET', `/me/tickets/${id}`, tess.token);
    expect(detail.body.transfer).toMatchObject({
      pendingTransferId: made.body.transferId,
      pendingTransferTo: 'Pat Lee',
    });
    expect(detail.body).toMatchObject({ pendingTransfer: true, status: 'active', rev: 0 });
    expect((await call('GET', '/me/tickets', tess.token)).body.data).toHaveLength(3);

    // Only the holder can cancel it, only for the ticket it is on.
    const other = await person('other-canceller');
    const cancelPath = `/me/tickets/${id}/transfers/${made.body.transferId}`;
    expect((await call('DELETE', cancelPath, other.token, undefined, keyed())).status).toBe(404);
    const wrongTicket = tessA.ticketIds[1] as string;
    expect(
      (
        await call(
          'DELETE',
          `/me/tickets/${wrongTicket}/transfers/${made.body.transferId}`,
          tess.token,
          undefined,
          keyed(),
        )
      ).status,
    ).toBe(404);
    const cancelKey = keyed();
    expect((await call('DELETE', cancelPath, tess.token, undefined, cancelKey)).status).toBe(204);
    expect((await call('DELETE', cancelPath, tess.token, undefined, cancelKey)).status).toBe(204);
    const again = await call('DELETE', cancelPath, tess.token, undefined, keyed());
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'invalid_state' });
    expect((await call('GET', `/me/tickets/${id}`, tess.token)).body.transfer.pendingTransferId).toBeNull();
  });

  it('someone else cannot transfer a ticket they do not hold', async () => {
    const thief = await person('thief');
    const r = await start(tessA.ticketIds[1] as string, thief.token, { toName: 'Me', toEmail: thief.email });
    expect(r.status).toBe(404);
    const [row] = await q<{ holder_email: string }>(
      sql`select holder_email from ticketing.tickets where id = ${tessA.ticketIds[1]}`,
      a,
    );
    expect(row?.holder_email).toBe(tess.email);
  });

  it('the ticket type’s rules decide: not allowed, past the cutoff', async () => {
    const id = tessA.ticketIds[1] as string;
    const to = { toName: 'Quinn', toEmail: `quinn-${suffix}@example.test` };
    await setType(a, eventA.typeId, { transfersAllowed: false });
    const refused = await start(id, tess.token, to);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'invalid_state', details: { reason: 'not_allowed' } });
    await setType(a, eventA.typeId, { transfersAllowed: true, transferCutoffHours: 8760 });
    const late = await start(id, tess.token, to);
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ details: { reason: 'deadline_passed' } });
    await setType(a, eventA.typeId, { transferCutoffHours: null });
  });

  it('a transfer fee is paid on the web: the app gets a link and nothing is started', async () => {
    const id = tessA.ticketIds[2] as string;
    await setType(a, eventA.typeId, { transferFeeMinor: 350 });
    const r = await start(id, tess.token, { toName: 'Robin', toEmail: `robin-${suffix}@example.test` });
    await setType(a, eventA.typeId, { transferFeeMinor: 0 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      status: 'web_payment_required',
      transferId: null,
      feeMinor: 350,
      currency: 'USD',
    });
    const url = new URL(r.body.webUrl);
    expect(url.origin).toBe('https://web.example.test');
    expect(url.pathname).toMatch(/^\/my-tickets\/[0-9a-f-]{36}~/);
    const holder = await holderContext(decodeURIComponent(url.pathname.replace('/my-tickets/', '')));
    expect(holder?.ctx.orgId).toBe(a.org.id);
    const [n] = await q<{ n: number }>(
      sql`select count(*)::int as n from ticketing.ticket_transfers where ticket_id = ${id}`,
      a,
    );
    expect(n?.n).toBe(0);
  });
});

describe('wallet passes', () => {
  let uma: Person;
  let umaA: Bought;
  beforeAll(async () => {
    uma = await person('uma');
    umaA = await buy(a, eventA, uma.email, 1);
  });

  it('returns a pass link per platform through the provider (the fake until the accounts exist)', async () => {
    const id = umaA.ticketIds[0] as string;
    const apple = await call('GET', `/me/tickets/${id}/wallet?platform=apple`, uma.token);
    expect(apple.status).toBe(200);
    expect(apple.body).toMatchObject({
      platform: 'apple',
      serial: `yy-${id}-0`,
      url: `https://wallet.fake.yayatoh.test/apple/yy-${id}-0`,
    });
    const google = await call('GET', `/me/tickets/${id}/wallet?platform=google`, uma.token);
    expect(google.body).toMatchObject({ platform: 'google', serial: `yy-${id}-0` });
    // One live pass per ticket and code revision, however often it is asked for.
    const [passes] = await q<{ n: number; active: number }>(
      sql`select count(*)::int as n, count(*) filter (where status = 'active')::int as active from ticketing.wallet_passes where ticket_id = ${id}`,
      a,
    );
    expect(passes).toEqual({ n: 1, active: 1 });
    expect((await call('GET', `/me/tickets/${id}/wallet?platform=windows`, uma.token)).status).toBe(400);
    expect((await call('GET', `/me/tickets/${id}/wallet`, uma.token)).status).toBe(400);
  });

  it('is a 404 for a ticket that is not yours', async () => {
    const stranger = await person('stranger-wallet');
    expect(
      (await call('GET', `/me/tickets/${umaA.ticketIds[0]}/wallet?platform=apple`, stranger.token)).status,
    ).toBe(404);
  });
});

describe('GET /v1/me/ticket-links/{token}', () => {
  let lena: Person;
  let lenaA: Bought;
  let linkToken: string;

  beforeAll(async () => {
    lena = await person('lena');
    lenaA = await buy(a, eventA, lena.email, 2);
    const ctx = systemCtx(a.org.id);
    const link = await withTenant(ctx, (tx) => issueHolderLinkTx(tx, ctx, eventA.id, lena.email));
    linkToken = link.token;
  });
  const open = (token: string, as?: string) => call('GET', `/me/ticket-links/${encodeURIComponent(token)}`, as);

  it('names the tickets of the link’s event for the address it was sent to, and never their codes', async () => {
    const r = await open(linkToken, lena.token);
    expect(r.status).toBe(200);
    expect([...r.body.ticketIds].sort()).toEqual([...lenaA.ticketIds].sort());
    expect(Object.keys(r.body)).toEqual(['ticketIds']);
    expect(r.text).not.toMatch(/yy1|qrCode|shortCode/);
    // The ids open the tickets through the ordinary route.
    expect((await call('GET', `/me/tickets/${r.body.ticketIds[0]}`, lena.token)).status).toBe(200);
  });

  it('is a 404 for anyone else, an unknown link and a tampered one, and needs a verified user session', async () => {
    const other = await person('ned');
    expect((await open(linkToken, other.token)).status).toBe(404);
    expect((await open(`${linkToken}x`, lena.token)).status).toBe(404);
    expect((await open('00000000-0000-4000-8000-000000000000~AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', lena.token)).status).toBe(404);
    expect((await open(linkToken)).status).toBe(401);
    const unverified = await person('linkunverified', false);
    expect((await open(linkToken, unverified.token)).status).toBe(403);
  });

  it('upper-case and lower-case spellings of the address are the same address', async () => {
    const mixed = await person('mixed', true, `Mixed-${suffix}@Example.test`);
    const bought = await buy(a, eventA, `mixed-${suffix}@example.test`, 1);
    const ctx = systemCtx(a.org.id);
    const link = await withTenant(ctx, (tx) => issueHolderLinkTx(tx, ctx, eventA.id, `MIXED-${suffix}@example.TEST`));
    const r = await open(link.token, mixed.token);
    expect(r.status).toBe(200);
    expect(r.body.ticketIds).toEqual(bought.ticketIds);
  });

  it('lists no ticket that has left the address (transferred away)', async () => {
    const mia = await person('mia');
    const miaA = await buy(a, eventA, mia.email, 1);
    const ctx = systemCtx(a.org.id);
    const link = await withTenant(ctx, (tx) => issueHolderLinkTx(tx, ctx, eventA.id, mia.email));
    expect((await open(link.token, mia.token)).body.ticketIds).toEqual(miaA.ticketIds);
    await q(sql`update ticketing.tickets set status = 'void' where id = ${miaA.ticketIds[0]}`, a);
    expect((await open(link.token, mia.token)).body.ticketIds).toEqual([]);
  });
});

describe('claims', () => {
  it('shows what a link offers and refuses a link that is not valid', async () => {
    const buyer = await buy(a, eventA, `host-${suffix}@example.test`, 2);
    const [link] = await executeCommand(
      createClaimLinksCommand,
      { eventId: eventA.id, ticketIds: [buyer.ticketIds[0] as string] },
      a.ctx(),
      ports,
    );
    const claimer = await person('claimer');
    const path = `/claims/${encodeURIComponent(link?.token as string)}`;
    const r = await call('GET', path, claimer.token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      state: 'open',
      ticketTypeName: 'General',
      event: { name: expect.stringContaining('Me Night'), timezone: 'America/Chicago' },
      organizerName: expect.any(String),
      transfer: null,
    });
    expect(r.text).not.toMatch(/qrCode|shortCode|code"/);
    expect((await call('GET', '/claims/definitely-not-a-claim-token', claimer.token)).status).toBe(404);
    expect((await call('GET', `/claims/${link?.token}x`, claimer.token)).status).toBe(404);
  });

  it('claims a plain link once; the buyer’s code stops working and the new holder reads the ticket', async () => {
    const buyer = await buy(a, eventA, `host2-${suffix}@example.test`, 1);
    const ticketId = buyer.ticketIds[0] as string;
    const [link] = await executeCommand(
      createClaimLinksCommand,
      { eventId: eventA.id, ticketIds: [ticketId] },
      a.ctx(),
      ports,
    );
    const claimer = await person('claimer2');
    const path = `/claims/${encodeURIComponent(link?.token as string)}`;
    const headers = keyed();
    const r = await call('POST', path, claimer.token, { name: 'Casey Claim' }, headers);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: ticketId, rev: 1, holderName: 'Casey Claim', status: 'active' });
    expect(r.body.qrCode).not.toBe((await orderByManageToken(buyer.token))?.tickets[0]?.code);
    expect(r.text).not.toMatch(/holderToken|my-tickets/);
    // Replaying the same key returns the ticket again; a second claimer is refused.
    expect((await call('POST', path, claimer.token, { name: 'Casey Claim' }, headers)).status).toBe(200);
    const late = await person('claimer-late');
    const second = await call('POST', path, late.token, {}, keyed());
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'invalid_state', details: { state: 'claimed' } });
    expect((await call('GET', '/me/tickets', claimer.token)).body.data.map((t: Json) => t.id)).toContain(
      ticketId,
    );
    expect((await call('GET', path, late.token)).body.state).toBe('claimed');
    // The claimant holds the ticket but did not buy it: no order of theirs.
    expect((await call('GET', '/me/orders', claimer.token)).body.data).toEqual([]);
  });

  it('a name defaults to the account’s; a claim needs a valid body', async () => {
    const buyer = await buy(a, eventA, `host3-${suffix}@example.test`, 1);
    const [link] = await executeCommand(
      createClaimLinksCommand,
      { eventId: eventA.id, ticketIds: [buyer.ticketIds[0] as string] },
      a.ctx(),
      ports,
    );
    const claimer = await person('claimer3');
    const path = `/claims/${encodeURIComponent(link?.token as string)}`;
    expect((await call('POST', path, claimer.token, { name: '' }, keyed())).status).toBe(400);
    expect((await call('POST', path, claimer.token, {})).status).toBe(400);
    const r = await call('POST', path, claimer.token, {}, keyed());
    expect(r.status).toBe(200);
    expect(r.body.holderName).toBe('claimer3');
  });

  it('a transfer is claimed only with the address it was sent to; then the sender’s ticket is gone', async () => {
    const sender = await person('sender');
    const bought = await buy(a, eventA, sender.email, 1);
    const ticketId = bought.ticketIds[0] as string;
    const recipient = await person('recipient');
    const started = await call(
      'POST',
      `/me/tickets/${ticketId}/transfers`,
      sender.token,
      { toName: 'Ray Recipient', toEmail: recipient.email.toUpperCase() },
      keyed(),
    );
    expect(started.status).toBe(201);
    const [t] = await q<{ claim_id: string }>(
      sql`select claim_id from ticketing.ticket_transfers where id = ${started.body.transferId}`,
      a,
    );
    const token = signLinkToken(CLAIM_PURPOSE, t?.claim_id as string);
    const path = `/claims/${encodeURIComponent(token)}`;

    // The old code, and a wallet pass for it.
    const oldCode = (await call('GET', `/me/tickets/${ticketId}`, sender.token)).body.qrCode;
    expect((await call('GET', `/me/tickets/${ticketId}/wallet?platform=apple`, sender.token)).status).toBe(
      200,
    );

    const offer = await call('GET', path, recipient.token);
    expect(offer.body).toMatchObject({
      state: 'open',
      transfer: { fromName: expect.any(String), toName: 'Ray Recipient' },
    });
    // The wrong account (a different verified address) cannot claim it.
    const intruder = await person('intruder');
    const wrong = await call('POST', path, intruder.token, {}, keyed());
    expect(wrong.status).toBe(400);
    expect(wrong.body).toMatchObject({ code: 'validation_failed', details: { reason: 'email_mismatch' } });
    expect((await call('GET', '/me/tickets', intruder.token)).body.data).toEqual([]);

    const ok = await call('POST', path, recipient.token, { name: 'Ray Recipient' }, keyed());
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: ticketId, rev: 1, holderName: 'Ray Recipient' });
    expect(ok.body.qrCode).not.toBe(oldCode);
    // The sender's list drops it, their detail is a 404, and their wallet link is gone.
    expect((await call('GET', '/me/tickets', sender.token)).body.data).toEqual([]);
    expect((await call('GET', `/me/tickets/${ticketId}`, sender.token)).status).toBe(404);
    expect((await call('GET', `/me/tickets/${ticketId}/wallet?platform=apple`, sender.token)).status).toBe(
      404,
    );
    // The old pass is voided and the new holder has one for the new code.
    const passes = await q<{ rev: number; status: string }>(
      sql`select rev, status from ticketing.wallet_passes where ticket_id = ${ticketId} order by rev`,
      a,
    );
    expect(passes).toEqual([
      { rev: 0, status: 'voided' },
      { rev: 1, status: 'active' },
    ]);
    // The sender still owns the order, which now says one ticket was passed on.
    const order = await call('GET', `/me/orders/${bought.orderId}`, sender.token);
    expect(order.body).toMatchObject({ ticketIds: [], transferred: 1 });
    // The recipient's ticket, and a transfer cannot be cancelled once claimed.
    expect((await call('GET', '/me/tickets', recipient.token)).body.data.map((x: Json) => x.id)).toEqual([
      ticketId,
    ]);
    expect(
      (
        await call(
          'DELETE',
          `/me/tickets/${ticketId}/transfers/${started.body.transferId}`,
          sender.token,
          undefined,
          keyed(),
        )
      ).status,
    ).toBe(404);
  });
});
