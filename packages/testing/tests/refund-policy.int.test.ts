import { setFeeOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  orderRefundsQuery,
  publicRefundPolicy,
  refundPolicyQuery,
  setRefundPolicyCommand,
  startCheckoutCommand,
  startPolicyOverrideRefundCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * The refund policy engine (M1.6e): per-event policy, evaluated in the refund command in the
 * event's timezone, the platform minimum, the organizer's retained fee, and the audited override.
 */
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let orderId: string;
let ticketIds: string[];
let financeId: string;
// Saturday 14 March 2026, 19:00 in Chicago; "until 7 days before" closes at 06:00Z on 8 March.
const STARTS = '2026-03-15T00:00:00Z';
const BEFORE = new Date('2026-03-08T05:59:59Z');
const AFTER = new Date('2026-03-08T06:00:00Z');
const SOLD = new Date('2026-03-01T12:00:00Z');

const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  withTenant(systemCtx(a.org.id), (tx) => tx.execute<T>(query));
const setPolicy = (input: Record<string, unknown>, ctx = a.ctx()) =>
  executeCommand(setRefundPolicyCommand, { eventId, ...input }, ctx, ports);
const refundFails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err as { code: string; details?: Record<string, unknown> };
  }
  throw new Error('expected a refusal');
};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  financeId = uuidv7();
  await executeCommand(addMemberCommand, { userId: financeId, role: 'finance' }, a.ctx(), ports);
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps: 1000, fixedMinor: 50, reason: 'test fee' },
    systemCtx(a.org.id),
    ports,
  );
  const e = await executeCommand(
    createEventCommand,
    { name: 'Policy Night', timezone: 'America/Chicago', startsAt: STARTS, endsAt: '2026-03-15T04:00:00Z' },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  const typeId = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'GA', priceMinor: 5000, quantityTotal: 20 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: typeId, quantity: 5 }],
      buyer: { email: 'pat@example.test', name: 'Pat Policy' },
    },
    createCtx({ orgId: a.org.id, now: SOLD }),
    ports,
  );
  orderId = c.order.id;
  await executeCommand(
    attachPaymentCommand,
    { orderId, provider: 'fake', providerPaymentId: `fakepi_policy_${orderId}` },
    createCtx({ orgId: a.org.id, now: SOLD }),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_policy_${orderId}`,
      type: 'payment.succeeded',
      providerPaymentId: `fakepi_policy_${orderId}`,
      amountMinor: c.order.totalMinor,
      currency: 'USD',
      orgId: a.org.id,
      orderId,
    },
    { ...systemCtx(a.org.id), now: SOLD },
    ports,
  );
  ticketIds = (
    await q<{ id: string }>(sql`select id from ticketing.tickets where order_id = ${orderId} order by serial`)
  ).map((r) => r.id);
});
afterAll(closePools);

const start = (input: Record<string, unknown>, now: Date, ctx = a.ctx({ now })) =>
  executeCommand(startRefundCommand, { orderId, ...input }, ctx, ports);
const complete = (refundId: string, now: Date) =>
  executeCommand(
    completeRefundCommand,
    { refundId, outcome: 'succeeded', providerRefundId: `fakere_${refundId}` },
    a.ctx({ now }),
    ports,
  );

describe('refund policy (M1.6e)', () => {
  it('validates the policy; only event editors set it; other orgs never see it', async () => {
    await expect(setPolicy({ kind: 'until' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(setPolicy({ kind: 'none', retainedMinor: 100 })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(setPolicy({ kind: 'always' }, userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(setPolicy({ kind: 'always' }, userCtx(financeId, a.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(setPolicy({ kind: 'always' }, b.ctx())).rejects.toMatchObject({ code: 'not_found' });

    const set = await setPolicy({ kind: 'until', daysBefore: 7, retainedMinor: 150 });
    expect(set).toMatchObject({
      kind: 'until',
      daysBefore: 7,
      retainedMinor: 150,
      timezone: 'America/Chicago',
    });
    expect(set?.deadline?.toISOString()).toBe(AFTER.toISOString());
    expect(
      await executeQuery(refundPolicyQuery, { eventId }, userCtx(a.viewerId, a.org.id), ports),
    ).toMatchObject({
      kind: 'until',
    });
    expect(await publicRefundPolicy(a.org.id, eventId)).toMatchObject({ kind: 'until', retainedMinor: 150 });
    expect(await publicRefundPolicy(b.org.id, eventId)).toBeNull();
  });

  it('inside the window: the buyer gets the ticket less the kept fee and the retained fee', async () => {
    const r = await start({ reason: 'requested_by_customer', ticketIds: [ticketIds[0]] }, BEFORE);
    // 5000 face + 550 fee (pass-on); the fee is kept for a buyer's request; 150 retained.
    expect(r).toMatchObject({ amountMinor: 5000 - 150, feeRefundedMinor: 0, retainedMinor: 150 });
    await complete(r.refundId, BEFORE);
    const [row] = await executeQuery(orderRefundsQuery, { orderId }, a.ctx(), ports);
    expect(row).toMatchObject({ retainedMinor: 150, policyOverride: false, status: 'succeeded' });
  });

  it('at the deadline a discretionary refund is refused with the reason and the deadline', async () => {
    for (const reason of ['requested_by_customer', 'goodwill'] as const) {
      const err = await refundFails(start({ reason, ticketIds: [ticketIds[1]] }, AFTER));
      expect(err).toMatchObject({
        code: 'invalid_state',
        details: { reason: 'policy_window_closed', deadline: AFTER.toISOString() },
      });
    }
    // An amount refund is discretionary too.
    expect(await refundFails(start({ reason: 'goodwill', amountMinor: 100 }, AFTER))).toMatchObject({
      details: { reason: 'policy_window_closed' },
    });
  });

  it('the platform minimum refunds in full after the window (cancellation)', async () => {
    const r = await start({ reason: 'event_cancelled', ticketIds: [ticketIds[1]] }, AFTER);
    expect(r).toMatchObject({ amountMinor: 5550, feeRefundedMinor: 550, retainedMinor: 0 });
    await complete(r.refundId, AFTER);
  });

  it('only owners and admins override, with a note; nothing is retained; the override is audited', async () => {
    const input = {
      orderId,
      reason: 'requested_by_customer',
      ticketIds: [ticketIds[2]],
      note: 'Hospital stay',
    };
    await expect(
      executeCommand(
        startPolicyOverrideRefundCommand,
        input,
        userCtx(financeId, a.org.id, { now: AFTER }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(startPolicyOverrideRefundCommand, { ...input, note: ' ' }, a.ctx({ now: AFTER }), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const r = await executeCommand(startPolicyOverrideRefundCommand, input, a.ctx({ now: AFTER }), ports);
    expect(r).toMatchObject({ amountMinor: 5000, retainedMinor: 0 });
    await complete(r.refundId, AFTER);
    const rows = await executeQuery(orderRefundsQuery, { orderId }, a.ctx(), ports);
    expect(rows.find((x) => x.id === r.refundId)).toMatchObject({ policyOverride: true, retainedMinor: 0 });
    const [audit] = await q<{ action: string; data: { note?: string } }>(
      sql`select action, data from platform.audit_events where action = 'order.refund_policy_override' and target_id = ${orderId}`,
    );
    expect(audit?.data.note).toBe('Hospital stay');
  });

  it('"no refunds" refuses a buyer request; clearing the policy leaves it to the organizer', async () => {
    await setPolicy({ kind: 'none' });
    expect(
      await refundFails(start({ reason: 'requested_by_customer', ticketIds: [ticketIds[3]] }, BEFORE)),
    ).toMatchObject({
      details: { reason: 'policy_no_refunds' },
    });
    expect(await setPolicy({ kind: 'unset' })).toBeNull();
    expect(await publicRefundPolicy(a.org.id, eventId)).toBeNull();
    const r = await start({ reason: 'requested_by_customer', ticketIds: [ticketIds[3]] }, AFTER);
    expect(r).toMatchObject({ amountMinor: 5000, retainedMinor: 0 });
  });
});
