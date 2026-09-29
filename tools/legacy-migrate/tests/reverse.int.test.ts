import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanTicketCommand } from '@yayatoh/checkin';
import { closePools } from '@yayatoh/db';
import { migratorSql } from '@yayatoh/db/migration';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  refundOrder,
  startCheckoutCommand,
} from '@yayatoh/orders';
import { fakePaymentProvider, memoryBalanceStore, signFakeWebhook } from '@yayatoh/payments';
import { ports } from '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { legacyFreezeProbe } from '../src/freeze-probe.ts';
import { reverseEtl, rollbackSql } from '../src/reverse-etl.ts';
import { rollbackRefunds } from '../src/rollback-refunds.ts';
import { runMigration } from '../src/run.ts';
import { generateDumpFile } from '../src/synth/generate.ts';

/**
 * M2.5a reverse ETL and the rollback refund, on the synthetic legacy dataset (both instances, yay
 * then abc, as every rehearsal). After the "cutover", the new platform sells (a platform_mor order
 * through the fake provider), refunds one ticket, and admits a new and a migrated ticket; the reverse
 * ETL writes all of it back in the legacy shape with ids ≥ 10M, reconciles to the cent, and a rerun
 * changes nothing. Then the rollback script refunds the SCT order at the provider exactly once.
 */
const SECRET = 'reverse-etl-secret-0123456789abcdef0123';
const store = memoryBalanceStore();
const fake = fakePaymentProvider({ secret: SECRET, appOrigin: 'http://localhost', store });
const dir = mkdtempSync(join(tmpdir(), 'legacy-reverse-'));
const sql = () => migratorSql();
const quiet = () => {};

let cutoverAt: Date;
let target: { orgId: string; eventId: string; typeId: string; startsAt: Date; legacyEventId: number };
let orderA: { id: string; tickets: { id: string; code: string }[]; total: number };
let orderB: { id: string; tickets: { id: string; code: string }[]; total: number };
let migrated: { ticketId: string; bookingId: number; code: string };

async function one<T>(q: Promise<T[]>): Promise<T> {
  const [r] = await q;
  if (!r) throw new Error('no row');
  return r;
}

async function buy(quantity: number, email: string) {
  const ctx = createCtx({ orgId: target.orgId });
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId: target.eventId,
      items: [{ ticketTypeId: target.typeId, quantity }],
      buyer: { email, name: 'Rolly Back' },
    },
    ctx,
    ports,
  );
  const pi = `fakepi_rev_${c.order.id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
    ctx,
    ports,
  );
  const s = signFakeWebhook(SECRET, {
    type: 'payment.succeeded',
    providerPaymentId: pi,
    amountMinor: c.order.totalMinor,
    currency: c.order.currency,
    orgId: target.orgId,
    orderId: c.order.id,
  });
  const evt = await fake.verifyWebhook(s.body, new Headers({ 'x-fake-signature': s.signature }));
  await executeCommand(
    applyProviderEventCommand,
    evt,
    createCtx({ orgId: target.orgId, actor: { type: 'system', name: 'webhook:fake' } }),
    ports,
  );
  const tickets = await sql()<{ id: string; code: string }[]>`
    select k.id, k.short_code as code from ticketing.tickets k where k.order_id = ${c.order.id} order by k.serial`;
  return { id: c.order.id, tickets, total: c.order.totalMinor };
}

const owner = () => createCtx({ orgId: target.orgId, actor: { type: 'system', name: 'test:rollback' } });
const staging = async (q: string, params: unknown[] = []) =>
  (await sql().unsafe(q, params as never[])) as unknown as Record<string, unknown>[];

beforeAll(async () => {
  const dumps = { yay: join(dir, 'yay.sql'), abc: join(dir, 'abc.sql') };
  await generateDumpFile(dumps.yay, { instance: 'yay', scale: 'small', demo: true });
  await generateDumpFile(dumps.abc, { instance: 'abc', scale: 'small' });
  for (const instance of ['yay', 'abc'] as const) {
    const r = await runMigration({ instance, mode: 'rehearsal', dump: dumps[instance], log: quiet });
    expect(r.pass).toBe(true);
  }
  cutoverAt = new Date();
  // A migrated yay event still ahead, with a migrated ticket type on sale and room for 3.
  const t = await one(sql()<
    { org_id: string; event_id: string; type_id: string; starts_at: Date; legacy_event_id: string }[]
  >`
    select e.org_id, e.id as event_id, tt.id as type_id, e.starts_at, er.legacy_id as legacy_event_id
    from legacy.ref er join events.events e on e.id = er.new_id
    join ticketing.ticket_types tt on tt.event_id = e.id
    join legacy.ref tr on tr.instance = 'yay' and tr.entity = 'tickets' and tr.new_id = tt.id
    where er.instance = 'yay' and er.entity = 'events' and e.status = 'published' and e.starts_at < now() and e.ends_at > now() + interval '1 day'
      and tt.price_minor > 0 and tt.quantity_total - tt.quantity_sold - tt.quantity_held >= 3
      and (tt.sales_start_at is null or tt.sales_start_at <= now()) and (tt.sales_end_at is null or tt.sales_end_at > now())
    order by e.starts_at, tt.id limit 1`);
  target = {
    orgId: t.org_id,
    eventId: t.event_id,
    typeId: t.type_id,
    startsAt: new Date(t.starts_at),
    legacyEventId: Number(t.legacy_event_id),
  };
  // A migrated, active, one-ticket booking of the same event (its legacy QR is the order number).
  const m = await one(sql()<{ ticket_id: string; booking_id: string; code: string }[]>`
    select u.new_id as ticket_id, b.id as booking_id, b.order_number as code
    from legacy.ref u
    join legacy_yay.bookings b on b.id = split_part(u.legacy_id, ':', 1)::bigint
    join ticketing.tickets k on k.id = u.new_id
    where u.instance = 'yay' and u.entity = 'booking_units' and b.quantity = 1 and b.distributed_from_booking_id is null
      and k.status = 'active' and k.event_id = ${target.eventId} and b.checked_in = 0
      and not exists (select 1 from checkin.admissions a where a.ticket_id = k.id and a.undone_at is null)
      and (select count(*) from legacy_yay.bookings d where d.order_number = b.order_number) = 1
    order by b.id limit 1`);
  migrated = { ticketId: m.ticket_id, bookingId: Number(m.booking_id), code: m.code };

  orderA = await buy(2, `rev-a-${Date.now()}@example.test`);
  orderB = await buy(1, `rev-b-${Date.now()}@example.test`);
  // After the cutover: refund one ticket of A, admit the other and the migrated ticket.
  await refundOrder(
    { orderId: orderA.id, reason: 'requested_by_customer', ticketIds: [orderA.tickets[1]?.id ?? ''] },
    owner(),
    ports,
    fake,
  );
  // Scanned now (after the cutover instant): the synthetic event is running.
  const door = createCtx({ orgId: target.orgId, actor: { type: 'system', name: 'test:door' } });
  for (const code of [orderA.tickets[0]?.code ?? '', migrated.code]) {
    const r = await executeCommand(scanTicketCommand, { eventId: target.eventId, code }, door, ports);
    expect(r.result).toBe('admitted');
  }
}, 300_000);

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await closePools();
});

describe('reverse ETL (M2.5a)', () => {
  let first: Awaited<ReturnType<typeof reverseEtl>>;

  it('the SCT order is a platform charge (platform_mor), as the rollback refund needs', async () => {
    const o = await one(
      sql()<{ funds_flow: string }[]>`select funds_flow from orders.orders where id = ${orderB.id}`,
    );
    expect(o.funds_flow).toBe('platform_mor');
  });

  it('a dry run reconciles the same way and writes nothing', async () => {
    const count = async () =>
      (await staging(`select count(*)::int as n from legacy_yay.bookings where id >= 10000000`))[0]?.n;
    const before = await count();
    const dry = await reverseEtl({ instance: 'yay', cutoverAt, dryRun: true, log: quiet });
    expect(dry.dryRun).toBe(true);
    expect(dry.pass).toBe(true);
    expect(dry.counts.orders).toEqual({ eligible: 2, written: 2 });
    expect(await count()).toBe(before);
    const refs = await staging(
      `select count(*)::int as n from legacy.reverse_ref where instance = 'yay' and new_id = any($1::text[])`,
      [[...orderA.tickets, ...orderB.tickets].map((t) => t.id)],
    );
    expect(refs[0]?.n).toBe(0);
  });

  it('writes post-cutover orders, tickets, attendees, refunds and check-ins in the legacy shape and reconciles', async () => {
    first = await reverseEtl({ instance: 'yay', cutoverAt, log: quiet });
    expect(first.checks.filter((c) => !c.pass)).toEqual([]);
    expect(first.pass).toBe(true);
    expect(first.counts.orders).toEqual({ eligible: 2, written: 2 });
    expect(first.counts).toMatchObject({ bookings: 3, attendees: 3, transactions: 2, commissions: 3 });
    expect(first.counts.refunds.applied).toBe(1);
    expect(first.counts.checkins.written).toBe(2);
    const cur = Object.keys(first.money)[0] as string;
    expect(first.money[cur]?.newTotalMinor).toBe(orderA.total + orderB.total);
    expect(first.money[cur]?.legacyPaidMinor).toBe(orderA.total + orderB.total);

    // The rows, with ids ≥ 10M, linked like the legacy app links them.
    const books = await staging(
      `select b.id, b.booking_cancel, b.checked_in, b.transaction_id, b.event_id, b.order_number, b.customer_email
       from legacy_yay.bookings b join legacy.reverse_ref r on r.instance = 'yay' and r.entity = 'bookings' and r.legacy_id = b.id
       order by b.id`,
    );
    expect(books).toHaveLength(3);
    for (const b of books) {
      expect(Number(b.id)).toBeGreaterThanOrEqual(10_000_000);
      expect(Number(b.event_id)).toBe(target.legacyEventId);
      expect(Number(b.transaction_id)).toBeGreaterThanOrEqual(10_000_000);
    }
    const byCode = new Map(books.map((b) => [b.order_number, b]));
    expect(Number(byCode.get(orderA.tickets[1]?.code)?.booking_cancel)).toBe(3);
    const admitted = byCode.get(orderA.tickets[0]?.code);
    expect([Number(admitted?.booking_cancel), Number(admitted?.checked_in)]).toEqual([0, 1]);
    // The migrated booking the door admitted.
    const mb = await staging(`select checked_in from legacy_yay.bookings where id = $1`, [
      migrated.bookingId,
    ]);
    expect(Number(mb[0]?.checked_in)).toBe(1);
    const checkins = await staging(`select booking_id from legacy_yay.checkins where booking_id = $1`, [
      migrated.bookingId,
    ]);
    expect(checkins.length).toBeGreaterThanOrEqual(1);
  });

  it('a rerun writes nothing new and reproduces the rows (idempotent)', async () => {
    const fingerprint = async () =>
      staging(
        `select r.entity, count(*)::int as n, md5(string_agg(r.new_id || ':' || r.legacy_id, ',' order by r.new_id)) as f
         from legacy.reverse_ref r where r.instance = 'yay' group by 1 order by 1`,
      );
    const before = await fingerprint();
    const again = await reverseEtl({ instance: 'yay', cutoverAt, log: quiet });
    expect(again.pass).toBe(true);
    expect(again.counts).toEqual(first.counts);
    expect(again.money).toEqual(first.money);
    expect(await fingerprint()).toEqual(before);
  });

  it('isolation: nothing of yay lands in abc, and abc has no reverse rows', async () => {
    const r = await reverseEtl({ instance: 'abc', cutoverAt, log: quiet });
    expect(r.pass).toBe(true);
    expect(r.counts.orders.written).toBe(0);
    const abc = await staging(
      `select count(*)::int as n from legacy_abc.bookings where id >= 10000000 or order_number = any($1::text[])`,
      [orderA.tickets.map((t) => t.code)],
    );
    expect(abc[0]?.n).toBe(0);
  });

  it('the MySQL script inserts the reverse rows and updates the migrated booking', async () => {
    const script = await rollbackSql('yay');
    expect(script).toMatch(/^-- Yayatoh reverse ETL for yay/);
    expect(script).toContain('START TRANSACTION;');
    expect(script.match(/INSERT INTO `bookings`/g)).toHaveLength(3);
    expect(script).toContain(
      `UPDATE \`bookings\` SET \`checked_in\` = 1 WHERE \`id\` = ${migrated.bookingId};`,
    );
    expect(script).toContain('ON DUPLICATE KEY UPDATE');
  });

  it('the legacy freeze probe sees the writes stamped after the freeze', async () => {
    const late = await legacyFreezeProbe('yay', cutoverAt);
    expect(late.pass).toBe(false);
    expect(late.tables.bookings?.after).toBeGreaterThanOrEqual(3);
    const quietProbe = await legacyFreezeProbe('yay', new Date(Date.now() + 48 * 3_600_000));
    expect(quietProbe.pass).toBe(true);
  });
});

describe('refunding a post-cutover SCT order after the rollback (M2.5a)', () => {
  it('plans without refunding, then refunds exactly once at the provider and cancels the legacy bookings', async () => {
    const plan = await rollbackRefunds({ instance: 'yay', cutoverAt, provider: fake, actor: 'test' });
    expect(plan.dryRun).toBe(true);
    expect(plan.items.find((i) => i.orderId === orderB.id)).toMatchObject({
      status: 'planned',
      amountMinor: orderB.total,
    });
    const refundsBefore = store
      .list(new Date(0), new Date(8.64e15))
      .filter((t) => t.kind === 'refund').length;

    const done = await rollbackRefunds({
      instance: 'yay',
      cutoverAt,
      provider: fake,
      orderIds: [orderB.id],
      actor: 'rehearsal:test',
    });
    expect(done.items.find((i) => i.orderId === orderB.id)).toMatchObject({
      status: 'succeeded',
      amountMinor: orderB.total,
      bookingsCancelled: 1,
    });
    expect(store.list(new Date(0), new Date(8.64e15)).filter((t) => t.kind === 'refund').length).toBe(
      refundsBefore + 1,
    );
    const b = await staging(
      `select b.booking_cancel from legacy_yay.bookings b
       join legacy.reverse_ref r on r.instance = 'yay' and r.entity = 'bookings' and r.legacy_id = b.id
       where r.new_id = $1`,
      [orderB.tickets[0]?.id],
    );
    expect(Number(b[0]?.booking_cancel)).toBe(3);

    // Again: already refunded, the provider is not called twice.
    const again = await rollbackRefunds({
      instance: 'yay',
      cutoverAt,
      provider: fake,
      orderIds: [orderB.id],
      actor: 'rehearsal:test',
    });
    expect(again.items.find((i) => i.orderId === orderB.id)?.status).toBe('already_refunded');
    expect(store.list(new Date(0), new Date(8.64e15)).filter((t) => t.kind === 'refund').length).toBe(
      refundsBefore + 1,
    );
  });

  it('an order whose event already had a transfer released is listed, never refunded here', async () => {
    await sql()`
      insert into payments.settlements (org_id, kind, event_id, currency, status, released_minor, amount_minor, released_at, transferred_at)
      values (${target.orgId}, 'event', ${target.eventId}, 'USD', 'transferred', 100, 100, now(), now())`;
    try {
      const plan = await rollbackRefunds({
        instance: 'yay',
        cutoverAt,
        provider: fake,
        orderIds: [orderA.id],
        actor: 'test',
      });
      expect(plan.items.find((i) => i.orderId === orderA.id)?.status).toBe('transfer_released');
    } finally {
      await sql()`delete from payments.settlements where org_id = ${target.orgId} and event_id = ${target.eventId} and amount_minor = 100`;
    }
  });
});
