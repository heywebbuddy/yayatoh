import { addGuestCommand } from '@yayatoh/attendees';
import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { buildRoundTable, buildRow } from '@yayatoh/floorplan';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { applyProviderEventCommand, attachPaymentCommand, startCheckoutCommand } from '@yayatoh/orders';
import { consumeEvent, memoryNotifier } from '@yayatoh/platform';
import {
  assignSeatCategoryCommand,
  assignSeatsCommand,
  FINDER_CODES_PER_HOUR,
  FINDER_RATE_LIMIT,
  finderCodeMailer,
  finderResultQuery,
  finderSettingsQuery,
  findSeatByNameCommand,
  publicVenueMapQuery,
  publishEventLayoutCommand,
  requestFinderCodeCommand,
  setEventLayoutCommand,
  setFinderSettingsCommand,
  verifyFinderCodeCommand,
} from '@yayatoh/seating';
import { finderCodeFor } from '@yayatoh/seating/testing';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
const row = buildRow({ label: 'R', count: 6, x: 300, y: 300 });
const table = buildRoundTable({ label: '1', seats: 4, x: 900, y: 800 });
const stage = {
  kind: 'object',
  id: uuidv7(),
  objectType: 'stage',
  label: 'Stage',
  x: 400,
  y: 20,
  width: 600,
  height: 150,
  rotation: 0,
};
const doors = { ...stage, id: uuidv7(), objectType: 'entrance', label: 'Main doors', x: 0, y: 1000 };
const doc = { version: 1, width: 1600, height: 1200, items: [stage, doors, row, table] };
const guests: Record<string, string> = {};
const email = (who: string) => `${who.toLowerCase().replace(/\W+/g, '.')}@finder.test`;
const anon = (now?: Date): Ctx => createCtx({ orgId: a.org.id, ...(now ? { now } : {}) });
let deviceN = 0;
/** A fresh device per call unless one is given: most tests shouldn't meet the rate limit. */
const device = () => `device-${++deviceN}-${uuidv7()}`;

const settings = (publicMap: boolean, mode: 'code' | 'name', ctx = a.ctx()) =>
  executeCommand(setFinderSettingsCommand, { eventId, publicMap, mode }, ctx, ports);
const request = (address: string, dev = device(), ctx = anon(), human = false) =>
  executeCommand(requestFinderCodeCommand, { eventId, email: address, device: dev, human }, ctx, ports);
const verify = (codeId: string, code: string, opts: { dev?: string; ctx?: Ctx; event?: string } = {}) =>
  executeCommand(
    verifyFinderCodeCommand,
    { eventId: opts.event ?? eventId, codeId, code, device: opts.dev ?? device() },
    opts.ctx ?? anon(),
    ports,
  );
const result = (codeId: string, ctx = anon()) =>
  executeQuery(finderResultQuery, { eventId, codeId }, ctx, ports);
const byName = (name: string, dev = device()) =>
  executeCommand(findSeatByNameCommand, { eventId, name, device: dev }, anon(), ports);

const codeRow = async (id: string) =>
  (
    await withTenant(a.ctx(), (tx) =>
      tx.execute<Record<string, unknown>>(sql`select * from seating.finder_codes where id = ${id}`),
    )
  )[0];
const codeRows = async () =>
  Number(
    (
      await withTenant(a.ctx(), (tx) =>
        tx.execute<{ n: number }>(
          sql`select count(*)::int as n from seating.finder_codes where event_id = ${eventId}`,
        ),
      )
    )[0]?.n,
  );
const outbox = async (codeId: string) =>
  withTenant(a.ctx(), (tx) =>
    tx.execute<{ id: string; type: string; payload: unknown }>(
      sql`select id, type, payload from platform.domain_events where aggregate_id = ${codeId}`,
    ),
  );
/** Run the worker's mailer over a code's event; returns what it queued with the notifier. */
async function mailFor(codeId: string) {
  const { notifier, sent } = memoryNotifier();
  const [evt] = await outbox(codeId);
  if (!evt) throw new Error('no outbox event');
  await consumeEvent(finderCodeMailer({ notifier, appOrigin: 'https://app.test' }), {
    id: evt.id,
    orgId: a.org.id,
    type: evt.type,
    version: 1,
    aggregateType: 'finder_code',
    aggregateId: codeId,
    payload: evt.payload,
    logSeq: 1,
  });
  return sent;
}
async function codeFor(address: string) {
  const r = await request(address);
  if (!r.codeId) throw new Error('no code');
  const [mail] = await mailFor(r.codeId);
  return { codeId: r.codeId, code: String(mail?.params.code ?? ''), mail };
}

async function buy(who: string, seats: string[]) {
  const r = await executeCommand(
    startCheckoutCommand,
    { eventId, items: [], seats, buyer: { email: email(who), name: who } },
    anon(),
    ports,
  );
  const pi = `fakepi_finder_${r.order.id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: r.order.id, provider: 'fake', providerPaymentId: pi },
    anon(),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_${pi}`,
      type: 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor: r.order.totalMinor,
      currency: 'USD',
      orgId: a.org.id,
      orderId: r.order.id,
    },
    systemCtx(a.org.id),
    ports,
  );
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Finder gala',
        timezone: 'UTC',
        startsAt: '2028-10-01T18:00:00Z',
        endsAt: '2028-10-01T23:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  const stalls = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'Stalls', priceMinor: 3000, quantityTotal: 6 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(setEventLayoutCommand, { eventId, doc }, a.ctx(), ports);
  await executeCommand(
    assignSeatCategoryCommand,
    { eventId, itemIds: [row.id], ticketTypeId: stalls },
    a.ctx(),
    ports,
  );
  await executeCommand(publishEventLayoutCommand, { eventId }, a.ctx(), ports);
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  const names = [
    'Ann Finder',
    'Ben Unseated',
    'Zoë Quinn',
    ...Array.from({ length: 8 }, (_, i) => `Known ${i}`),
  ];
  for (const name of names)
    guests[name] = (
      await executeCommand(addGuestCommand, { eventId, name, email: email(name) }, a.ctx(), ports)
    ).id;
  await executeCommand(
    assignSeatsCommand,
    {
      eventId,
      attendeeIds: [guests['Ann Finder'] as string],
      itemId: table.id,
      seatUuid: table.seats[2]?.id,
    },
    a.ctx(),
    ports,
  );
  await executeCommand(
    assignSeatsCommand,
    { eventId, attendeeIds: [guests['Zoë Quinn'] as string], itemId: table.id },
    a.ctx(),
    ports,
  );
  // A party: one buyer, two seats (both tickets carry the buyer's email).
  await buy('Party Buyer', [row.seats[0]?.id ?? '', row.seats[1]?.id ?? '']);
});
afterAll(closePools);

describe('seat finder settings (M1.7e)', () => {
  it('is closed until the organizer opens it; viewers cannot change it', async () => {
    expect(await executeQuery(finderSettingsQuery, { eventId }, a.ctx(), ports)).toEqual({
      publicMap: false,
      mode: 'code',
    });
    expect(await executeQuery(publicVenueMapQuery, { eventId }, anon(), ports)).toBeNull();
    await expect(request(email('Ann Finder'))).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'finder_closed' },
    });
    await expect(settings(true, 'code', userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await settings(true, 'code')).toEqual({ publicMap: true, mode: 'code' });
    // The venue map: the plan as drawn and the lookup mode, nothing about people.
    const map = await executeQuery(publicVenueMapQuery, { eventId }, anon(), ports);
    // M4.2b: plus the published table sponsors (none here).
    expect(Object.keys(map ?? {}).sort()).toEqual(['doc', 'mode', 'sponsors']);
    expect(map?.sponsors).toEqual([]);
    expect(map?.doc.items.map((i) => (i.kind === 'object' ? i.objectType : i.kind))).toEqual([
      'stage',
      'entrance',
      'row',
      'table',
    ]);
    const [audit] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ data: unknown }>(
        sql`select data from platform.audit_events where action = 'seating.finder_settings' and target_id = ${eventId}`,
      ),
    );
    expect(audit?.data).toEqual({ publicMap: true, mode: 'code' });
    // An event without a plan has nothing to open.
    const bare = await executeCommand(
      createEventCommand,
      { name: 'No plan', timezone: 'UTC', startsAt: '2028-10-01T18:00:00Z', endsAt: '2028-10-01T23:00:00Z' },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(
        setFinderSettingsCommand,
        { eventId: bare.id, publicMap: true, mode: 'code' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('needs the seat_finder module', async () => {
    const off = { moduleKey: 'seat_finder', reason: 'test' } as const;
    await executeCommand(
      setEntitlementOverrideCommand,
      { ...off, effect: 'revoke' },
      systemCtx(b.org.id),
      ports,
    );
    await expect(
      executeQuery(publicVenueMapQuery, { eventId: b.event.id }, createCtx({ orgId: b.org.id }), ports),
    ).rejects.toMatchObject({ code: 'module_not_enabled' });
    await expect(
      executeCommand(
        requestFinderCodeCommand,
        { eventId: b.event.id, email: 'x@finder.test', device: device() },
        createCtx({ orgId: b.org.id }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'module_not_enabled' });
    await executeCommand(
      setEntitlementOverrideCommand,
      { ...off, effect: 'grant' },
      systemCtx(b.org.id),
      ports,
    );
    expect(
      await executeQuery(publicVenueMapQuery, { eventId: b.event.id }, createCtx({ orgId: b.org.id }), ports),
    ).not.toBeNull();
  });
});

describe('codes by email: no enumeration', () => {
  it('answers and works the same for an address on the list and one that is not; only the listed one is mailed', async () => {
    const known = await request(email('Known 0'));
    const unknown = await request(`stranger.${uuidv7()}@finder.test`);
    expect(Object.keys(known).sort()).toEqual(Object.keys(unknown).sort());
    expect(known.status).toBe('sent');
    expect(unknown.status).toBe('sent');
    const [k, u] = [await codeRow(known.codeId ?? ''), await codeRow(unknown.codeId ?? '')];
    // Both leave a row, an outbox event and an audit row; only the listed one keeps an address.
    expect(k?.email).toBe(email('Known 0'));
    expect(u?.email).toBeNull();
    expect(String(k?.code_hash)).toHaveLength(64);
    expect(String(u?.code_hash)).toHaveLength(64);
    expect((await outbox(known.codeId ?? '')).map((e) => e.type)).toEqual(['seating.finder_code_created']);
    expect((await outbox(unknown.codeId ?? '')).map((e) => e.type)).toEqual(['seating.finder_code_created']);
    const audits = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ data: { status: string; codeId: string } }>(
        sql`select data from platform.audit_events where action = 'seating.finder_code_request' and target_id = ${eventId}`,
      ),
    );
    const byCode = new Map(audits.map((r) => [r.data.codeId, r.data]));
    expect(Object.keys(byCode.get(known.codeId ?? '') ?? {}).sort()).toEqual(['codeId', 'status']);
    expect(Object.keys(byCode.get(unknown.codeId ?? '') ?? {}).sort()).toEqual(['codeId', 'status']);
    // The mailer sends only to the listed address, with a six-digit code and the finder's link.
    expect(await mailFor(unknown.codeId ?? '')).toEqual([]);
    const [mail] = await mailFor(known.codeId ?? '');
    expect(mail?.to.email).toBe(email('Known 0'));
    expect(mail?.kind).toBe('seating.finder-code');
    expect(String(mail?.params.code)).toMatch(/^\d{6}$/);
    expect(mail?.params.url).toBe(`https://app.test/events/${await slugOf(eventId)}/seat-finder`);
    expect(mail?.dedupeKey).toBe(`finder-code:${known.codeId}`);
  });

  it('takes about as long either way (no timing oracle)', async () => {
    const time = async (fn: () => Promise<unknown>) => {
      const t0 = performance.now();
      await fn();
      return performance.now() - t0;
    };
    const kt: number[] = [];
    const ut: number[] = [];
    for (let i = 1; i < 8; i++) {
      kt.push(await time(() => request(email(`Known ${i}`))));
      ut.push(await time(() => request(`nobody.${i}.${uuidv7()}@finder.test`)));
    }
    const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)] ?? 0;
    const [km, um] = [median(kt), median(ut)];
    // Same statements either way; allow generous noise for a shared CI database.
    expect(Math.max(km, um) / Math.min(km, um)).toBeLessThan(2.5);
  });
});

const slugOf = async (id: string) =>
  (
    await withTenant(a.ctx(), (tx) =>
      tx.execute<{ slug: string }>(sql`select slug from events.events where id = ${id}`),
    )
  )[0]?.slug;

describe('one-time codes', () => {
  it('are hashed at rest: no column or event carries the code', async () => {
    const { codeId, code } = await codeFor(email('Known 1'));
    const r = await codeRow(codeId);
    expect(JSON.stringify(r)).not.toContain(code);
    expect(String(r?.code_hash)).not.toContain(code);
    expect(JSON.stringify((await outbox(codeId)).map((e) => e.payload))).not.toContain(code);
    expect(code).toBe(finderCodeFor(codeId));
  });

  it('count wrong tries and lock after five, even against the right code', async () => {
    const { codeId, code } = await codeFor(email('Known 2'));
    const wrong = code === '000000' ? '111111' : '000000';
    for (const left of [4, 3, 2, 1])
      expect(await verify(codeId, wrong)).toEqual({ status: 'wrong', attemptsLeft: left });
    expect(await verify(codeId, wrong)).toEqual({ status: 'locked', attemptsLeft: 0 });
    expect(await verify(codeId, code)).toEqual({ status: 'locked', attemptsLeft: 0 });
    expect((await codeRow(codeId))?.attempts).toBe(5);
    // Malformed codes are refused before they count.
    await expect(verify(codeId, '12ab56')).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('work once, for ten minutes', async () => {
    const first = await codeFor(email('Known 3'));
    expect(await verify(first.codeId, first.code)).toEqual({ status: 'ok', attemptsLeft: null });
    expect(await verify(first.codeId, first.code)).toEqual({ status: 'used', attemptsLeft: null });
    const second = await codeFor(email('Known 3'));
    const later = new Date(Date.now() + 11 * 60_000);
    expect(await verify(second.codeId, second.code, { ctx: anon(later) })).toEqual({
      status: 'expired',
      attemptsLeft: null,
    });
    // A code from another event, or one that never existed, is simply not valid here.
    expect(await verify(uuidv7(), '123456')).toEqual({ status: 'expired', attemptsLeft: null });
  });

  it('an unlisted address can never verify, even with the code its row would have had', async () => {
    const r = await request(`ghost.${uuidv7()}@finder.test`);
    const decoy = r.codeId ?? '';
    expect(await verify(decoy, finderCodeFor(decoy))).toEqual({ status: 'wrong', attemptsLeft: 4 });
    await expect(result(decoy)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('show the guest their seat, only after verifying and for a day', async () => {
    const { codeId, code } = await codeFor(email('Ann Finder'));
    await expect(result(codeId)).rejects.toMatchObject({ code: 'not_found' });
    await verify(codeId, code);
    const mine = await result(codeId);
    expect(mine).toEqual({
      found: true,
      seats: [
        {
          seatUuid: table.seats[2]?.id,
          itemId: table.id,
          itemKind: 'table',
          itemLabel: '1',
          seatLabel: '3',
          sponsor: null,
          sponsorLogoUrl: null,
        },
      ],
      unseated: 0,
    });
    // Allowlisted: no names, emails or other guests.
    expect(JSON.stringify(mine)).not.toMatch(/Finder|Zo|@/);
    await expect(result(codeId, anon(new Date(Date.now() + 25 * 3_600_000)))).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('a party sees all its seats; someone on the list without a seat is told so', async () => {
    const party = await codeFor(email('Party Buyer'));
    await verify(party.codeId, party.code);
    const seats = (await result(party.codeId)).seats;
    expect(seats.map((s) => [s.itemKind, s.itemLabel, s.seatLabel])).toEqual([
      ['row', 'R', '1'],
      ['row', 'R', '2'],
    ]);
    const ben = await codeFor(email('Ben Unseated'));
    await verify(ben.codeId, ben.code);
    expect(await result(ben.codeId)).toEqual({ found: true, seats: [], unseated: 1 });
  });

  it(`sends at most ${FINDER_CODES_PER_HOUR} codes an hour to one address; then the last one stands`, async () => {
    const who = email('Known 7');
    const ids: string[] = [];
    // One request already went to this address in the timing test.
    for (let i = 1; i < FINDER_CODES_PER_HOUR; i++) ids.push((await request(who)).codeId ?? '');
    const before = await codeRows();
    const again = await request(who);
    expect(again).toEqual({ status: 'sent', codeId: ids.at(-1) });
    expect(await codeRows()).toBe(before);
  });
});

describe('abuse limits', () => {
  it(`allows ${FINDER_RATE_LIMIT} lookups a minute per device and event, then asks for a challenge`, async () => {
    const dev = device();
    for (let i = 0; i < FINDER_RATE_LIMIT; i++)
      expect((await request(`flood.${i}.${uuidv7()}@finder.test`, dev)).status).toBe('sent');
    const before = await codeRows();
    expect(await request(email('Known 4'), dev)).toEqual({ status: 'challenge', codeId: null });
    expect(await verify(uuidv7(), '123456', { dev })).toEqual({ status: 'challenge', attemptsLeft: null });
    expect(await codeRows()).toBe(before);
    // A passed challenge lets the request through; another device has its own budget.
    expect((await request(email('Known 4'), dev, anon(), true)).status).toBe('sent');
    expect((await request(email('Known 4'), device())).status).toBe('sent');
    // The next minute starts a new window.
    const next = new Date(Date.now() + 61_000);
    expect((await request(email('Known 4'), dev, anon(next))).status).toBe('sent');
  });

  it('keeps each org to its own codes (RLS)', async () => {
    const { codeId, code } = await codeFor(email('Known 5'));
    const bctx = createCtx({ orgId: b.org.id });
    expect(await verify(codeId, code, { ctx: bctx, event: b.event.id })).toEqual({
      status: 'expired',
      attemptsLeft: null,
    });
    await expect(
      executeQuery(finderResultQuery, { eventId: b.event.id, codeId }, bctx, ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Still unused in org A.
    expect((await verify(codeId, code)).status).toBe('ok');
  });
});

describe('instant name lookup (organizer opt-in)', () => {
  it('finds exact full names only, case and spacing aside; codes are refused in this mode', async () => {
    await expect(byName('Ann Finder')).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'finder_mode' },
    });
    await settings(true, 'name');
    await expect(request(email('Ann Finder'))).rejects.toMatchObject({
      details: { reason: 'finder_mode' },
    });
    const hit = await byName('  ann   FINDER ');
    expect(hit.status).toBe('ok');
    expect(hit.result?.seats.map((s) => [s.itemLabel, s.seatLabel])).toEqual([['1', '3']]);
    expect((await byName('zoë quinn')).result?.found).toBe(true);
    for (const partial of ['Ann', 'Finder', 'Ann Finde', 'ann.finder@finder.test'])
      expect((await byName(partial)).result).toEqual({ found: false, seats: [], unseated: 0 });
    const [audit] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ data: unknown }>(
        sql`select data from platform.audit_events where action = 'seating.finder_name_lookup' order by created_at limit 1`,
      ),
    );
    expect(audit?.data).toEqual({ status: 'ok', found: true });
    // Rate-limited like codes.
    const dev = device();
    for (let i = 0; i < FINDER_RATE_LIMIT; i++) await byName(`Nobody ${i}`, dev);
    expect(await byName('Ann Finder', dev)).toEqual({ status: 'challenge', result: null });
    // Closing the finder closes the map too.
    await settings(false, 'name');
    expect(await executeQuery(publicVenueMapQuery, { eventId }, anon(), ports)).toBeNull();
    await expect(byName('Ann Finder')).rejects.toMatchObject({ code: 'not_found' });
    await settings(true, 'code');
  });
});
