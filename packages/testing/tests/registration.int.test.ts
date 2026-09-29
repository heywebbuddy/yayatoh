import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  expireOrdersCommand,
  listWaitlistsQuery,
  offerWaitlistEntryCommand,
  startCheckoutCommand,
  startRefundCommand,
  ticketCancelBulk,
  updateWaitlistCommand,
  waitlistEntriesQuery,
  waitlistToken,
} from '@yayatoh/orders';
import { consumeEvent, type PublishedEvent, recentEventsTx } from '@yayatoh/platform';
import {
  archiveRegistrationTypeCommand,
  createAdmissionItemCommand,
  createRegistrationTypeCommand,
  disableCellCommand,
  joinRegistrationWaitlistCommand,
  publicRegistration,
  type RegistrationSetupDto,
  registrationCapacity,
  registrationSetupQuery,
  registrationTypeRefsQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  startRegistrationCommand,
  updateRegistrationTypeCommand,
} from '@yayatoh/registration';
import { archiveTicketTypeCommand, listTicketTypesQuery, updateTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let n = 0;
const HOUR = 3_600_000;
const later = (ms: number) => new Date(Date.now() + ms);
const anon = (now?: Date): Ctx => createCtx({ orgId: a.org.id, ...(now ? { now } : {}) });
const sys = (now?: Date): Ctx => ({ ...systemCtx(a.org.id), ...(now ? { now } : {}) });
const viewer = () => userCtx(a.viewerId, a.org.id);
const subscriber = registrationCapacity();

interface Conf {
  eventId: string;
  setup: RegistrationSetupDto;
  typeId: string;
  fullPass: string;
  dayPass: string;
  dinner: string;
}

/** A published conference with the default types and items; Member × {full, day, dinner} priced. */
async function conference(opts: { capacity?: number | null; price?: number } = {}): Promise<Conf> {
  n += 1;
  const e = await executeCommand(
    createEventCommand,
    {
      name: `Conference ${n} ${a.org.slug}`,
      timezone: 'America/Chicago',
      startsAt: '2027-11-01T14:00:00Z',
      endsAt: '2027-11-03T23:00:00Z',
    },
    a.ctx(),
    ports,
  );
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: e.id, names: {} }, a.ctx(), ports);
  let setup = await executeQuery(registrationSetupQuery, { eventId: e.id }, a.ctx(), ports);
  const member = setup.types.find((t) => t.key === 'member');
  const item = (key: string) => setup.items.find((i) => i.key === key)?.id as string;
  if (!member) throw new Error('no member type');
  if (opts.capacity !== undefined)
    await executeCommand(
      updateRegistrationTypeCommand,
      { eventId: e.id, registrationTypeId: member.id, name: member.name, capacity: opts.capacity },
      a.ctx(),
      ports,
    );
  for (const [key, price] of [
    ['full_pass', opts.price ?? 30000],
    ['day_pass', 12000],
    ['dinner', 5000],
  ] as const)
    await executeCommand(
      setCellCommand,
      { eventId: e.id, registrationTypeId: member.id, admissionItemId: item(key), priceMinor: price },
      a.ctx(),
      ports,
    );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
  setup = await executeQuery(registrationSetupQuery, { eventId: e.id }, a.ctx(), ports);
  return {
    eventId: e.id,
    setup,
    typeId: member.id,
    fullPass: item('full_pass'),
    dayPass: item('day_pass'),
    dinner: item('dinner'),
  };
}

const register = (c: Conf, email: string, extra: Record<string, unknown> = {}, ctx = anon()) =>
  executeCommand(
    startRegistrationCommand,
    {
      eventId: c.eventId,
      registrationTypeId: c.typeId,
      itemIds: [c.fullPass],
      buyer: { email, name: 'Buyer' },
      ...extra,
    },
    ctx,
    ports,
  );

const counter = async (c: Conf, typeId = c.typeId) => {
  const t = (await executeQuery(registrationSetupQuery, { eventId: c.eventId }, a.ctx(), ports)).types.find(
    (x) => x.id === typeId,
  );
  return { held: t?.quantityHeld, sold: t?.quantitySold, waiting: t?.waiting, offered: t?.offered };
};

/** Run the capacity subscriber over this org's recent events it takes (as the worker would). */
async function drain(): Promise<number> {
  const events = await withTenant(sys(), (tx) =>
    recentEventsTx(tx, a.org.id, [...new Set(subscriber.events.map((e) => e.split('@')[0] as string))], HOUR),
  );
  let done = 0;
  for (const e of events) if (await consumeEvent(subscriber, e)) done += 1;
  return done;
}

/** Hand one event to the handler directly, bypassing processed_events (a replay). */
const replay = (e: PublishedEvent) => withTenant(sys(), (tx) => subscriber.handle(tx, e));

const eventsOf = async (type: string, orderId: string) =>
  (await withTenant(sys(), (tx) => recentEventsTx(tx, a.org.id, [type], HOUR))).filter(
    (e) => (e.payload as { orderId?: string }).orderId === orderId,
  );

async function pay(orderId: string, totalMinor: number, tag: string) {
  await executeCommand(
    attachPaymentCommand,
    { orderId, provider: 'fake', providerPaymentId: `fakepi_reg_${tag}` },
    anon(),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_reg_${tag}`,
      type: 'payment.succeeded',
      providerPaymentId: `fakepi_reg_${tag}`,
      amountMinor: totalMinor,
      currency: 'USD',
      orgId: a.org.id,
      orderId,
    },
    sys(),
    ports,
  );
}

const lapse = () =>
  executeCommand(
    expireOrdersCommand,
    {},
    { ...sys(later(11 * 60_000)), actor: { type: 'system', name: 'sweeper' } },
    ports,
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
}, 180_000);

afterAll(async () => {
  await closePools();
});

describe('registration setup', () => {
  it('seeds the default types and items once, activates the conference pack, maps cells onto managed passes', async () => {
    const c = await conference();
    expect(c.setup.types.map((t) => t.key)).toEqual([
      'member',
      'non_member',
      'student',
      'exhibitor',
      'speaker',
      'vip',
    ]);
    expect(c.setup.items.map((i) => [i.key, i.kind])).toEqual([
      ['full_pass', 'admission'],
      ['day_pass', 'admission'],
      ['workshop', 'add_on'],
      ['dinner', 'add_on'],
    ]);
    expect(c.setup.pack).toMatchObject({ active: true, source: 'beta_free' });
    expect(c.setup.pack.quotas.registrants).toBe(5000);
    // Seeding again adds nothing.
    expect(
      await executeCommand(
        seedRegistrationDefaultsCommand,
        { eventId: c.eventId, names: {} },
        a.ctx(),
        ports,
      ),
    ).toEqual({ types: 0, items: 0 });
    expect(c.setup.cells).toHaveLength(3);
    const tickets = await executeQuery(listTicketTypesQuery, { eventId: c.eventId }, a.ctx(), ports);
    const full = c.setup.cells.find((x) => x.admissionItemId === c.fullPass);
    const t = tickets.find((x) => x.id === full?.ticketTypeId);
    expect(t).toMatchObject({
      name: 'Member · Full pass',
      visibility: 'hidden',
      managedBy: 'registration',
      maxPerOrder: 1,
    });
    // Changing a cell's price changes its pass; a rename renames the passes.
    await executeCommand(
      setCellCommand,
      { eventId: c.eventId, registrationTypeId: c.typeId, admissionItemId: c.fullPass, priceMinor: 27500 },
      a.ctx(),
      ports,
    );
    await executeCommand(
      updateRegistrationTypeCommand,
      { eventId: c.eventId, registrationTypeId: c.typeId, name: 'Association member' },
      a.ctx(),
      ports,
    );
    const again = (await executeQuery(listTicketTypesQuery, { eventId: c.eventId }, a.ctx(), ports)).find(
      (x) => x.id === full?.ticketTypeId,
    );
    expect(again).toMatchObject({ priceMinor: 27500, name: 'Association member · Full pass' });
    const refs = await executeQuery(registrationTypeRefsQuery, { eventId: c.eventId }, a.ctx(), ports);
    expect(refs[0]).toEqual({ id: c.typeId, key: 'member', name: 'Association member' });
  });

  it('a managed pass is refused on the Tickets page, at public checkout and by the box office path', async () => {
    const c = await conference();
    const ticketTypeId = c.setup.cells[0]?.ticketTypeId as string;
    await expect(
      executeCommand(updateTicketTypeCommand, { ticketTypeId, priceMinor: 1 }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'managed' } });
    await expect(
      executeCommand(archiveTicketTypeCommand, { ticketTypeId }, a.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    });
    // A forged public checkout naming the pass directly never reaches the type's capacity or eligibility.
    await expect(
      executeCommand(
        startCheckoutCommand,
        {
          eventId: c.eventId,
          items: [{ ticketTypeId, quantity: 1 }],
          buyer: { email: 'forger@example.test', name: 'F' },
        },
        anon(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('validates types: codes, domains, keys, capacity floor', async () => {
    const c = await conference({ capacity: 2 });
    const bad = (input: Record<string, unknown>) =>
      executeCommand(
        createRegistrationTypeCommand,
        { eventId: c.eventId, name: 'X', ...input },
        a.ctx(),
        ports,
      );
    await expect(bad({ eligibility: 'access_code' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(bad({ eligibility: 'access_code', accessCode: 'a b' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(bad({ eligibility: 'email_domain', emailDomains: ['not a domain'] })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(bad({ eligibility: 'email_domain', emailDomains: [] })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(bad({ key: 'member' })).rejects.toMatchObject({
      code: 'conflict',
      details: { field: 'key' },
    });
    const ok = await bad({ eligibility: 'email_domain', emailDomains: ['@Acme.ORG', 'acme.org', 'uni.edu'] });
    expect(ok).toMatchObject({
      key: 'x',
      eligibility: 'email_domain',
      emailDomains: ['acme.org', 'uni.edu'],
    });
    await register(c, 'one@example.test');
    await expect(
      executeCommand(
        updateRegistrationTypeCommand,
        { eventId: c.eventId, registrationTypeId: c.typeId, name: 'Member', capacity: 0 },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'capacity_below_taken', minimum: 1 },
    });
  });

  it('the viewer reads the page and is refused on every write', async () => {
    const c = await conference();
    const setup = await executeQuery(registrationSetupQuery, { eventId: c.eventId }, viewer(), ports);
    expect(setup.types).toHaveLength(6);
    const writes: [unknown, Record<string, unknown>][] = [
      [seedRegistrationDefaultsCommand, { eventId: c.eventId, names: {} }],
      [createRegistrationTypeCommand, { eventId: c.eventId, name: 'Nope' }],
      [updateRegistrationTypeCommand, { eventId: c.eventId, registrationTypeId: c.typeId, name: 'Nope' }],
      [archiveRegistrationTypeCommand, { eventId: c.eventId, registrationTypeId: c.typeId }],
      [createAdmissionItemCommand, { eventId: c.eventId, name: 'Nope' }],
      [
        setCellCommand,
        { eventId: c.eventId, registrationTypeId: c.typeId, admissionItemId: c.dinner, priceMinor: 1 },
      ],
      [disableCellCommand, { eventId: c.eventId, registrationTypeId: c.typeId, admissionItemId: c.dinner }],
    ];
    for (const [cmd, input] of writes)
      await expect(executeCommand(cmd as never, input, viewer(), ports)).rejects.toMatchObject({
        code: 'forbidden',
      });
  });

  it('disabling a cell archives its pass and takes the item off checkout', async () => {
    const c = await conference();
    await executeCommand(
      disableCellCommand,
      { eventId: c.eventId, registrationTypeId: c.typeId, admissionItemId: c.dinner },
      a.ctx(),
      ports,
    );
    await expect(
      register(c, 'dinner@example.test', { itemIds: [c.fullPass, c.dinner] }),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'item_unavailable' } });
    const pub = await publicRegistration(a.org.id, c.eventId);
    expect(pub.items[c.typeId]?.map((i) => i.id)).toEqual([c.fullPass, c.dayPass]);
  });
});

describe('checkout', () => {
  it('registers one pass plus add-ons; exactly one admission item', async () => {
    const c = await conference();
    const r = await register(c, 'ann@example.test', { itemIds: [c.dayPass, c.dinner] });
    expect(r.order.items).toHaveLength(2);
    expect(r.order.status).toBe('reserved');
    await expect(register(c, 'bo@example.test', { itemIds: [c.dinner] })).rejects.toMatchObject({
      details: { reason: 'choose_admission' },
    });
    await expect(register(c, 'bo@example.test', { itemIds: [c.fullPass, c.dayPass] })).rejects.toMatchObject({
      details: { reason: 'one_admission' },
    });
    expect(await counter(c)).toMatchObject({ held: 1, sold: 0 });
  });

  it('50 concurrent checkouts never oversell a per-type capacity', async () => {
    const c = await conference({ capacity: 20 });
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) => register(c, `rush${i}@example.test`)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(20);
    for (const r of refused)
      expect(r.reason).toMatchObject({ code: 'conflict', details: { reason: 'type_full' } });
    expect(await counter(c)).toMatchObject({ held: 20, sold: 0 });
    // The database agrees: never more than the capacity, and the claims add up.
    const [row] = await withTenant(sys(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select coalesce(sum(quantity_held + quantity_sold), 0)::int as n from registration.capacity_claims where registration_type_id = ${c.typeId}`,
      ),
    );
    expect(row?.n).toBe(20);
    // The CHECK itself refuses a write past the capacity.
    await expect(
      withTenant(sys(), (tx) =>
        tx.execute(
          sql`update registration.registration_types set quantity_held = quantity_held + 1 where id = ${c.typeId}`,
        ),
      ),
    ).rejects.toSatisfy((err: Error & { cause?: { message?: string } }) =>
      /registration_types_capacity_check/.test(`${err.message} ${err.cause?.message ?? ''}`),
    );
  }, 120_000);

  it('releases on expiry exactly once, whatever replays', async () => {
    const c = await conference({ capacity: 5 });
    const r = await register(c, 'late@example.test');
    expect(await counter(c)).toMatchObject({ held: 1 });
    await lapse();
    await drain();
    expect(await counter(c)).toMatchObject({ held: 0, sold: 0 });
    const [expired] = await eventsOf('order.expired', r.order.id);
    if (!expired) throw new Error('no expiry event');
    for (let i = 0; i < 3; i++) await replay(expired);
    expect(await drain()).toBe(0);
    expect(await counter(c)).toMatchObject({ held: 0, sold: 0 });
  });

  it('moves a place from held to sold when paid; an add-on refund keeps it; a pass refund releases it once', async () => {
    const c = await conference({ capacity: 5 });
    const r = await register(c, 'paid@example.test', { itemIds: [c.fullPass, c.dinner] });
    await pay(r.order.id, r.order.totalMinor, `p${n}`);
    await drain();
    expect(await counter(c)).toMatchObject({ held: 0, sold: 1 });
    const [paid] = await eventsOf('order.paid', r.order.id);
    if (paid) await replay(paid);
    expect(await counter(c)).toMatchObject({ held: 0, sold: 1 });
    const ticketsOf = async (itemId: string) => {
      const cell = c.setup.cells.find((x) => x.admissionItemId === itemId);
      return (
        await withTenant(sys(), (tx) =>
          tx.execute<{ id: string }>(
            sql`select id from ticketing.tickets where order_id = ${r.order.id} and ticket_type_id = ${cell?.ticketTypeId}`,
          ),
        )
      ).map((t) => t.id);
    };
    const refundTickets = async (ticketIds: string[]) => {
      const refund = await executeCommand(
        startRefundCommand,
        { orderId: r.order.id, reason: 'duplicate', ticketIds },
        a.ctx(),
        ports,
      );
      await executeCommand(
        completeRefundCommand,
        { refundId: refund.refundId, outcome: 'succeeded', providerRefundId: `fakere_${refund.refundId}` },
        a.ctx(),
        ports,
      );
      await drain();
    };
    // Only admission tickets count: refunding the dinner keeps the registrant's place.
    await refundTickets(await ticketsOf(c.dinner));
    expect(await counter(c)).toMatchObject({ held: 0, sold: 1 });
    await refundTickets(await ticketsOf(c.fullPass));
    expect(await counter(c)).toMatchObject({ held: 0, sold: 0 });
    const refunds = await eventsOf('order.refunded', r.order.id);
    expect(refunds).toHaveLength(2);
    for (const e of refunds) await replay(e);
    if (paid) await replay(paid);
    expect(await counter(c)).toMatchObject({ held: 0, sold: 0 });
  });

  it('cancelling the pass ticket (no refund) releases the place once', async () => {
    const c = await conference({ capacity: 2, price: 0 });
    const r = await register(c, 'cancel@example.test');
    expect(await counter(c)).toMatchObject({ sold: 1 });
    const attendees = await withTenant(sys(), (tx) =>
      tx.execute<{ id: string }>(
        sql`select a.id from attendees.attendees a join ticketing.tickets t on t.id = a.ticket_id where t.order_id = ${r.order.id}`,
      ),
    );
    const op = await executeCommand(
      ticketCancelBulk.start,
      { eventId: c.eventId, selection: { ids: attendees.map((x) => x.id) }, params: {} },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    await drain();
    expect(await counter(c)).toMatchObject({ held: 0, sold: 0 });
    const cancelled = (
      await withTenant(sys(), (tx) => recentEventsTx(tx, a.org.id, ['tickets.cancelled'], HOUR))
    ).at(-1);
    if (!cancelled) throw new Error('no cancel event');
    await replay(cancelled);
    await replay(cancelled);
    expect(await counter(c)).toMatchObject({ held: 0, sold: 0 });
  });

  it('a free registration is sold at once', async () => {
    const c = await conference({ capacity: 3, price: 0 });
    const r = await register(c, 'free@example.test');
    expect(r.order.status).toBe('paid');
    expect(await counter(c)).toMatchObject({ held: 0, sold: 1 });
    await drain();
    expect(await counter(c)).toMatchObject({ held: 0, sold: 1 });
  });
});

describe('eligibility in the command', () => {
  let c: Conf;
  let codeType: string;
  let domainType: string;
  beforeAll(async () => {
    c = await conference();
    const code = await executeCommand(
      createRegistrationTypeCommand,
      { eventId: c.eventId, name: 'Press', eligibility: 'access_code', accessCode: 'press-2027' },
      a.ctx(),
      ports,
    );
    const dom = await executeCommand(
      createRegistrationTypeCommand,
      { eventId: c.eventId, name: 'Staff', eligibility: 'email_domain', emailDomains: ['acme.org'] },
      a.ctx(),
      ports,
    );
    codeType = code.id;
    domainType = dom.id;
    for (const t of [codeType, domainType])
      await executeCommand(
        setCellCommand,
        { eventId: c.eventId, registrationTypeId: t, admissionItemId: c.fullPass, priceMinor: 1000 },
        a.ctx(),
        ports,
      );
  });

  it('refuses a forged request for a code type without the code, or with a wrong one', async () => {
    const as = (extra: Record<string, unknown>) =>
      register({ ...c, typeId: codeType }, 'eve@example.test', extra);
    await expect(as({})).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'code_required' } });
    await expect(as({ accessCode: 'PRESS-2028' })).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'code_wrong' },
    });
    await expect(as({ accessCode: 'press-2027' })).resolves.toMatchObject({ registrationTypeId: codeType });
  });

  it('refuses a forged request for a domain type from another domain', async () => {
    const as = (email: string) => register({ ...c, typeId: domainType }, email);
    await expect(as('eve@gmail.com')).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'domain_not_allowed' },
    });
    await expect(as('eve@acme.org.evil.com')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(as('kim@events.acme.org')).resolves.toMatchObject({ registrationTypeId: domainType });
  });

  it('the public read shows only types this buyer may pick, as an allowlist', async () => {
    const anyone = await publicRegistration(a.org.id, c.eventId, { email: 'x@gmail.com' });
    const ids = anyone.types.map((t) => t.id);
    expect(ids).toContain(c.typeId);
    expect(ids).not.toContain(codeType);
    expect(ids).not.toContain(domainType);
    const staff = await publicRegistration(a.org.id, c.eventId, {
      email: 'x@acme.org',
      accessCode: 'PRESS-2027',
    });
    expect(staff.types.map((t) => t.id)).toEqual(expect.arrayContaining([codeType, domainType]));
    const member = anyone.types.find((t) => t.id === c.typeId);
    expect(Object.keys(member ?? {}).sort()).toEqual(
      ['currency', 'description', 'full', 'id', 'maxAllInMinor', 'minAllInMinor', 'name'].sort(),
    );
    expect(JSON.stringify(staff)).not.toMatch(/PRESS-2027|acme\.org/);
    // Seeded types with no cells are not offered.
    expect(anyone.types).toHaveLength(1);
  });

  it('refuses an ineligible buyer on the waitlist too', async () => {
    await expect(
      executeCommand(
        joinRegistrationWaitlistCommand,
        {
          eventId: c.eventId,
          registrationTypeId: domainType,
          admissionItemId: c.fullPass,
          name: 'E',
          email: 'e@gmail.com',
        },
        anon(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('per-type waitlist (M3.10a lines and timed offers)', () => {
  it('a full type takes a line; a freed place is offered to the first in line, then bought with the link', async () => {
    const c = await conference({ capacity: 1 });
    const first = await register(c, 'first@example.test');
    await expect(register(c, 'second@example.test')).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'type_full', waitlist: true },
    });
    const join = (email: string, item = c.fullPass) =>
      executeCommand(
        joinRegistrationWaitlistCommand,
        { eventId: c.eventId, registrationTypeId: c.typeId, admissionItemId: item, name: 'Waiting', email },
        anon(),
        ports,
      );
    const second = await join('second@example.test');
    const third = await join('third@example.test', c.dayPass);
    expect(second).toMatchObject({ position: 1, alreadyJoined: false });
    expect(await counter(c)).toMatchObject({ held: 1, waiting: 2, offered: 0 });
    // Managed lines: no automatic offers, and the organizer's console can't offer on them.
    const lists = await executeQuery(listWaitlistsQuery, { eventId: c.eventId }, a.ctx(), ports);
    expect(lists.every((l) => !l.autoOffer)).toBe(true);
    await expect(
      executeCommand(offerWaitlistEntryCommand, { entryId: second.entryId }, a.ctx(), ports),
    ).rejects.toMatchObject({ details: { reason: 'managed' } });
    await expect(
      executeCommand(
        updateWaitlistCommand,
        { waitlistId: lists[0]?.id as string, autoOffer: true },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'managed' } });
    // The first checkout lapses: its place goes to the head of the type's line, once.
    await lapse();
    await drain();
    await drain();
    expect(await counter(c)).toMatchObject({ held: 0, offered: 1, waiting: 1 });
    const statusOf = async (entryId: string) => {
      for (const l of await executeQuery(listWaitlistsQuery, { eventId: c.eventId }, a.ctx(), ports)) {
        const e = (
          await executeQuery(waitlistEntriesQuery, { waitlistId: l.id }, a.ctx(), ports)
        ).entries.find((x) => x.id === entryId);
        if (e) return e.status;
      }
      return null;
    };
    expect(await statusOf(second.entryId)).toBe('offered');
    expect(await statusOf(third.entryId)).toBe('waiting');
    // The public still can't take the offered place.
    await expect(register(c, 'fourth@example.test')).rejects.toMatchObject({
      details: { reason: 'type_full' },
    });
    expect(first.order.status).toBe('reserved');
    // The offer is bought through registration checkout with its link.
    const bought = await register(c, 'second@example.test', { waitlistToken: waitlistToken(second.entryId) });
    expect(bought.registrationTypeId).toBe(c.typeId);
    expect(await counter(c)).toMatchObject({ held: 1, offered: 0, waiting: 1 });
    expect(await statusOf(second.entryId)).toBe('accepted');
  });

  it('an offer on a code-only type is bought with its link alone, only by the address it was made to', async () => {
    const c = await conference();
    const press = await executeCommand(
      createRegistrationTypeCommand,
      {
        eventId: c.eventId,
        name: 'Press',
        eligibility: 'access_code',
        accessCode: 'PRESS-OFFER',
        capacity: 1,
      },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setCellCommand,
      { eventId: c.eventId, registrationTypeId: press.id, admissionItemId: c.fullPass, priceMinor: 1000 },
      a.ctx(),
      ports,
    );
    const p = { ...c, typeId: press.id };
    await register(p, 'holder@example.test', { accessCode: 'PRESS-OFFER' });
    const entry = await executeCommand(
      joinRegistrationWaitlistCommand,
      {
        eventId: c.eventId,
        registrationTypeId: press.id,
        admissionItemId: c.fullPass,
        name: 'Reporter',
        email: 'reporter@example.test',
        accessCode: 'press-offer',
      },
      anon(),
      ports,
    );
    await lapse();
    await drain();
    expect(await counter(c, press.id)).toMatchObject({ held: 0, offered: 1 });
    const link = waitlistToken(entry.entryId);
    await expect(register(p, 'someone.else@example.test', { waitlistToken: link })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(register(p, 'reporter@example.test', { waitlistToken: link })).resolves.toMatchObject({
      registrationTypeId: press.id,
    });
    expect(await counter(c, press.id)).toMatchObject({ held: 1, offered: 0 });
  });

  it('refuses to join while places are open, and raising the capacity offers the next place', async () => {
    const c = await conference({ capacity: 1 });
    const join = (email: string) =>
      executeCommand(
        joinRegistrationWaitlistCommand,
        { eventId: c.eventId, registrationTypeId: c.typeId, admissionItemId: c.fullPass, name: 'W', email },
        anon(),
        ports,
      );
    await expect(join('early@example.test')).rejects.toMatchObject({ details: { reason: 'not_sold_out' } });
    await register(c, 'taker@example.test');
    await join('next@example.test');
    await executeCommand(
      updateRegistrationTypeCommand,
      { eventId: c.eventId, registrationTypeId: c.typeId, name: 'Member', capacity: 2 },
      a.ctx(),
      ports,
    );
    expect(await counter(c)).toMatchObject({ held: 1, offered: 1, waiting: 0 });
  });
});

describe('entitlement and isolation', () => {
  it('another org sees nothing and cannot buy or join', async () => {
    const c = await conference({ capacity: 5 });
    await expect(
      executeQuery(registrationSetupQuery, { eventId: c.eventId }, b.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(register(c, 'x@example.test', {}, createCtx({ orgId: b.org.id }))).rejects.toMatchObject({
      code: 'not_found',
    });
    const rows = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute(sql`select 1 from registration.registration_types where event_id = ${c.eventId}`),
    );
    expect(rows).toHaveLength(0);
  });

  it('every command and query is refused while the registration module is off', async () => {
    const c = await conference();
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'registration', effect: 'revoke', reason: 'test' },
      systemCtx(a.org.id),
      ports,
    );
    try {
      await expect(
        executeQuery(registrationSetupQuery, { eventId: c.eventId }, a.ctx(), ports),
      ).rejects.toMatchObject({
        code: 'module_not_enabled',
      });
      await expect(
        executeCommand(createRegistrationTypeCommand, { eventId: c.eventId, name: 'Off' }, a.ctx(), ports),
      ).rejects.toMatchObject({ code: 'module_not_enabled' });
      await expect(register(c, 'off@example.test')).rejects.toMatchObject({ code: 'module_not_enabled' });
    } finally {
      await executeCommand(
        setEntitlementOverrideCommand,
        { moduleKey: 'registration', effect: 'grant', reason: 'test' },
        systemCtx(a.org.id),
        ports,
      );
    }
  });
});
