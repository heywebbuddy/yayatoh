import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand } from '@yayatoh/events';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { MAX_BULK_ITEMS } from '@yayatoh/platform';
import { BOOKING_EXPORT_COLUMNS, bookingsExportBulk, decimal } from '@yayatoh/reports';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, runBulk, twoOrgs, userCtx } from '../src/index.ts';
import { ports } from '../src/ports.ts';

/**
 * M1.12c acceptance: "a 50k-row export completes". 50 000 generated bookings are inserted
 * straight into the orders table (as the superuser, for speed), then exported through the bulk
 * framework exactly as the console does it.
 */

let a: OrgFixture;
let b: OrgFixture;
let admin: AdminSql;
let eventId: string;
const ROWS = MAX_BULK_ITEMS;

const params = {
  headers: Object.fromEntries(BOOKING_EXPORT_COLUMNS.map((c) => [c, c])) as Record<
    (typeof BOOKING_EXPORT_COLUMNS)[number],
    string
  >,
  statuses: { paid: 'Paid', refunded: 'Refunded' },
  channels: { platform: 'Online', organizer: 'Box office' },
};

async function generate(orgId: string, event: string, typeId: string, n: number, prefix: string) {
  await admin`
    insert into orders.orders (org_id, event_id, status, buyer_email, buyer_name, currency, subtotal_minor,
      discount_minor, fee_minor, total_minor, funds_flow, fee_schedule, manage_token_hash, paid_at, created_at)
    select ${orgId}, ${event}, 'paid', ${prefix} || g || '@example.test',
      case when g = 1 then '=HYPERLINK("http://evil.test")' else 'Buyer ' || g end,
      'USD', 1000 + (g % 7), 0, 100, 1100 + (g % 7), 'platform_mor', '{}'::jsonb,
      md5(${prefix} || g::text || random()::text), now(), now() - (g || ' seconds')::interval
    from generate_series(1, ${n}) g`;
  await admin`
    insert into orders.order_items (org_id, order_id, ticket_type_id, name, quantity, unit_face_minor,
      unit_fee_minor, unit_all_in_minor, unit_organizer_net_minor)
    select o.org_id, o.id, ${typeId}, 'General', 1, o.subtotal_minor, o.fee_minor, o.total_minor, o.subtotal_minor
    from orders.orders o where o.event_id = ${event}`;
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  admin = adminClient();
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Big export',
        timezone: 'Asia/Tokyo',
        startsAt: '2028-09-01T09:00:00Z',
        endsAt: '2028-09-01T12:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  const typeId = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'General', priceMinor: 1000, quantityTotal: 100_000 },
      a.ctx(),
      ports,
    )
  ).id;
  await generate(a.org.id, eventId, typeId, ROWS, 'bulk');
}, 120_000);
afterAll(async () => {
  await admin?.end();
  await closePools();
});

describe('bookings export (M1.12c)', () => {
  it('exports 50 000 bookings to a CSV whose totals equal the golden query', async () => {
    const started = Date.now();
    const { operationId, total } = await executeCommand(
      bookingsExportBulk.start,
      { eventId, selection: { filter: { q: '', filter: 'all' } }, params },
      a.ctx(),
      ports,
    );
    expect(total).toBe(ROWS);
    expect(await runBulk(a.org.id, operationId, 300_000)).toBe('done');
    const elapsed = Date.now() - started;
    const status = await executeQuery(bookingsExportBulk.status, { operationId }, a.ctx(), ports);
    expect(status).toMatchObject({ status: 'done', total: ROWS, succeeded: ROWS, failed: 0, hasFile: true });
    const file = await executeQuery(bookingsExportBulk.file, { operationId }, a.ctx(), ports);
    expect(file.name).toMatch(/^bookings-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = file.content.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines).toHaveLength(ROWS + 1);
    expect(lines[0]).toBe(BOOKING_EXPORT_COLUMNS.join(','));
    // Allowlist: exactly the declared columns, no tokens or payment references.
    expect(file.content).not.toMatch(/fakepi_|manage|fee_schedule/);
    // CSV injection is neutralised.
    expect(file.content).toContain(`"'=HYPERLINK(""http://evil.test"")"`);
    // Totals in the file equal the golden SQL total.
    const sum = lines.slice(1).reduce((n, l) => n + Math.round(Number(l.split(',')[5]) * 100), 0);
    const [g] = await admin<{ s: string }[]>`
      select sum(total_minor)::text s from orders.orders where org_id = ${a.org.id} and event_id = ${eventId}`;
    expect(sum).toBe(Number(g?.s));
    // Times are in the event's timezone (Tokyo, UTC+9).
    expect(lines[1]).toMatch(/,\d{4}-\d{2}-\d{2} \d{2}:\d{2},\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    console.info(`50k bookings export: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(240_000);
  }, 300_000);

  it('refuses a selection above the cap, one-by-one ids, and roles without the export permission', async () => {
    await admin`
      insert into orders.orders (org_id, event_id, status, buyer_email, buyer_name, currency, subtotal_minor,
        discount_minor, fee_minor, total_minor, funds_flow, fee_schedule, manage_token_hash)
      values (${a.org.id}, ${eventId}, 'expired', 'extra@example.test', 'Extra', 'USD', 0, 0, 0, 0,
        'platform_mor', '{}'::jsonb, md5(random()::text))`;
    await expect(
      executeCommand(
        bookingsExportBulk.start,
        { eventId, selection: { filter: { filter: 'all' } }, params },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        bookingsExportBulk.start,
        { eventId, selection: { ids: [eventId] }, params },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        bookingsExportBulk.start,
        { eventId, selection: { filter: { filter: 'paid', q: 'bulk1@' } }, params },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it("exports only the selection, and another org cannot read the operation or the event's bookings", async () => {
    const { operationId, total } = await executeCommand(
      bookingsExportBulk.start,
      { eventId, selection: { filter: { q: 'bulk12345@', filter: 'paid' } }, params },
      a.ctx(),
      ports,
    );
    expect(total).toBe(1);
    expect(await runBulk(a.org.id, operationId)).toBe('done');
    const file = await executeQuery(bookingsExportBulk.file, { operationId }, a.ctx(), ports);
    const lines = file.content.trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('bulk12345@example.test');
    expect(lines[1]).toContain(`,${decimal(1100 + (12345 % 7), 'USD')},USD,,Online,`);
    await expect(
      executeQuery(bookingsExportBulk.status, { operationId }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(
        bookingsExportBulk.start,
        { eventId, selection: { filter: { filter: 'all' } }, params },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('formats money as plain decimals per currency exponent', () => {
    expect(decimal(1234, 'USD')).toBe('12.34');
    expect(decimal(5, 'USD')).toBe('0.05');
    expect(decimal(-250, 'EUR')).toBe('-2.50');
    expect(decimal(1200, 'JPY')).toBe('1200');
    expect(decimal(1234, 'KWD')).toBe('1.234');
  });
});
