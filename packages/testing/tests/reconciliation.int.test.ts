import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  refundOrder,
  startCheckoutCommand,
} from '@yayatoh/orders';
import {
  fakePaymentProvider,
  memoryBalanceStore,
  reconcileOrgDay,
  reconciliationItemsQuery,
  reconciliationRunsQuery,
  recordReconciliationCommand,
  resolveReconciliationItemCommand,
  signFakeWebhook,
} from '@yayatoh/payments';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * Daily reconciliation (M1.6e): the ledger's platform cash against the provider's balance
 * transactions, one run per org and day, differences for finance to resolve with a note.
 */
const SECRET = 'reconciliation-test-secret-0123456789abcdef';
let a: OrgFixture;
let b: OrgFixture;
let financeId: string;
let eventId: string;
let typeId: string;
let now = new Date('2027-05-10T10:00:00Z');
const store = memoryBalanceStore();
const fake = fakePaymentProvider({ secret: SECRET, appOrigin: 'http://localhost', store, now: () => now });

/** A paid order: checkout, then a signed fake webhook the provider records as a charge. */
async function paidOrder(at: Date, opts: { providerSees: boolean } = { providerSees: true }) {
  now = at;
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: typeId, quantity: 1 }],
      buyer: { email: 'rae@example.test', name: 'Rae Recon' },
    },
    createCtx({ orgId: a.org.id, now: at }),
    ports,
  );
  const pi = `fakepi_recon_${c.order.id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
    createCtx({ orgId: a.org.id, now: at }),
    ports,
  );
  const signed = signFakeWebhook(SECRET, {
    type: 'payment.succeeded',
    providerPaymentId: pi,
    amountMinor: c.order.totalMinor,
    currency: 'USD',
    orgId: a.org.id,
    orderId: c.order.id,
  });
  const event = opts.providerSees
    ? await fake.verifyWebhook(signed.body, new Headers({ 'x-fake-signature': signed.signature }))
    : { ...JSON.parse(signed.body), provider: 'fake' };
  await executeCommand(applyProviderEventCommand, event, { ...systemCtx(a.org.id), now: at }, ports);
  return c.order;
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  financeId = uuidv7();
  await executeCommand(addMemberCommand, { userId: financeId, role: 'finance' }, a.ctx(), ports);
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Recon Night',
        timezone: 'UTC',
        startsAt: '2027-06-01T18:00:00Z',
        endsAt: '2027-06-01T22:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  typeId = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'GA', priceMinor: 4000, quantityTotal: 50 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

describe('daily reconciliation (M1.6e)', () => {
  it('a sale and a refund the provider also saw reconcile with no differences, once per day', async () => {
    const order = await paidOrder(new Date('2027-05-10T10:00:00Z'));
    now = new Date('2027-05-10T15:00:00Z');
    await refundOrder(
      { orderId: order.id, reason: 'goodwill', amountMinor: 1000 },
      a.ctx({ now }),
      ports,
      fake,
    );
    const run = await reconcileOrgDay(fake, a.org.id, '2027-05-10', ports);
    expect(run).toMatchObject({ created: true, itemCount: 0, ledgerCount: 2, providerCount: 2 });
    // Idempotent per org and day: the second run is the first.
    store.add({
      id: 'fakebt_late',
      kind: 'charge',
      amountMinor: 1,
      currency: 'USD',
      occurredAt: new Date('2027-05-10T20:00:00Z'),
      orgId: a.org.id,
      reference: 'order:late',
    });
    const again = await reconcileOrgDay(fake, a.org.id, '2027-05-10', ports);
    expect(again).toMatchObject({ created: false, runId: run?.runId, itemCount: 0 });
  });

  it('drift becomes items: money the provider moved without a journal, and a journal it never saw', async () => {
    const ghost = await paidOrder(new Date('2027-05-11T09:00:00Z'), { providerSees: false });
    store.add({
      id: 'fakebt_unknown',
      kind: 'refund',
      amountMinor: -700,
      currency: 'USD',
      occurredAt: new Date('2027-05-11T12:00:00Z'),
      orgId: a.org.id,
      reference: 'refund:00000000-0000-7000-8000-000000000abc',
    });
    const run = await reconcileOrgDay(fake, a.org.id, '2027-05-11', ports);
    expect(run).toMatchObject({ created: true, itemCount: 2 });
    const items = await executeQuery(reconciliationItemsQuery, {}, userCtx(financeId, a.org.id), ports);
    expect(
      items.filter((i) => i.day === '2027-05-11').map((i) => [i.kind, i.reference, i.differenceMinor]),
    ).toEqual([
      ['missing_at_provider', `order:${ghost.id}`, -ghost.totalMinor],
      ['missing_in_ledger', 'refund:00000000-0000-7000-8000-000000000abc', -700],
    ]);
    const runs = await executeQuery(reconciliationRunsQuery, {}, a.ctx(), ports);
    expect(runs.find((r) => r.day === '2027-05-11')).toMatchObject({ itemCount: 2, runId: run?.runId });
    // Drift raises the alert event through the outbox.
    const [evt] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ payload: { items: number } }>(
        sql`select payload from platform.domain_events where type = 'payments.reconciliation_drift' and aggregate_id = ${run?.runId}`,
      ),
    );
    expect(evt?.payload.items).toBe(2);
  });

  it('finance resolves an item with a note (audited); viewers cannot read or resolve; other orgs never see it', async () => {
    const [item] = await executeQuery(reconciliationItemsQuery, { status: 'open' }, a.ctx(), ports);
    if (!item) throw new Error('no open item');
    await expect(
      executeQuery(reconciliationItemsQuery, {}, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        resolveReconciliationItemCommand,
        { itemId: item.id, note: 'Checked' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        resolveReconciliationItemCommand,
        { itemId: item.id, note: 'ok' },
        userCtx(financeId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(resolveReconciliationItemCommand, { itemId: item.id, note: 'Not ours' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(
      (await executeQuery(reconciliationItemsQuery, {}, b.ctx(), ports)).some((i) => i.id === item.id),
    ).toBe(false);

    const note = 'Webhook replayed by hand; booked in the next run';
    await executeCommand(
      resolveReconciliationItemCommand,
      { itemId: item.id, note },
      userCtx(financeId, a.org.id),
      ports,
    );
    const after = (await executeQuery(reconciliationItemsQuery, {}, a.ctx(), ports)).find(
      (i) => i.id === item.id,
    );
    expect(after).toMatchObject({ status: 'resolved', resolutionNote: note });
    await expect(
      executeCommand(resolveReconciliationItemCommand, { itemId: item.id, note }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    const [audit] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ data: { note: string } }>(
        sql`select data from platform.audit_events where action = 'payments.reconciliation_resolve' and target_id = ${item.id}`,
      ),
    );
    expect(audit?.data.note).toBe(note);
  });

  it('only the platform records runs', async () => {
    await expect(
      executeCommand(
        recordReconciliationCommand,
        { day: '2027-05-12', provider: 'fake', transactions: [] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
