import { setFeeOverrideCommand } from '@yayatoh/billing';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  massRefundStatusQuery,
  pauseMassRefundCommand,
  resumeMassRefundCommand,
  startCheckoutCommand,
  startMassRefundCommand,
} from '@yayatoh/orders';
import { fakePaymentProvider } from '@yayatoh/payments';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueueDueMassRefunds, MASS_REFUND_JOB, massRefundJob } from '../src/mass-refunds.ts';
import { startWorker } from '../src/worker.ts';

/**
 * M3.10b: the mass refund runs as the pg-boss job `orders.mass-refund`, one job per run at a time
 * (an exclusive queue keyed by the run), queued again by the leader's tick until the run is done;
 * a paused run is not worked.
 */
let a: OrgFixture;
let eventId: string;
let runId: string;
let boss: PgBoss;
const provider = fakePaymentProvider({
  secret: 'worker-mass-refund-secret-0123456789',
  appOrigin: 'https://app.test',
});

const status = () => executeQuery(massRefundStatusQuery, { runId }, a.ctx(), ports);
async function until(check: () => Promise<boolean>, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 200));
  }
}

const audited: string[] = [];

beforeAll(async () => {
  setPlatformAuditSink(async ({ actor }) => void audited.push(actor));
  ({ a } = await twoOrgs());
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps: 1000, fixedMinor: 50, reason: 'test fee' },
    systemCtx(a.org.id),
    ports,
  );
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Worker Night',
        timezone: 'UTC',
        startsAt: '2027-07-01T18:00:00Z',
        endsAt: '2027-07-01T22:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  const typeId = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'GA', priceMinor: 2000, quantityTotal: 20 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  for (let i = 0; i < 6; i++) {
    const c = await executeCommand(
      startCheckoutCommand,
      {
        eventId,
        items: [{ ticketTypeId: typeId, quantity: 1 }],
        buyer: { email: `w${i}@example.test`, name: 'W' },
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    const pi = `fakepi_worker_${c.order.id}`;
    await executeCommand(
      attachPaymentCommand,
      { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    await executeCommand(
      applyProviderEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_worker_${c.order.id}`,
        type: 'payment.succeeded',
        providerPaymentId: pi,
        amountMinor: c.order.totalMinor,
        currency: 'USD',
        orgId: a.org.id,
        orderId: c.order.id,
      },
      systemCtx(a.org.id),
      ports,
    );
  }
  await executeCommand(transitionEventCommand, { eventId, transition: 'cancel' }, a.ctx(), ports);
  runId = (await executeCommand(startMassRefundCommand, { eventId }, a.ctx(), ports)).runId;
  // A tiny budget: each job works about one order, then the tick queues the next.
  boss = await startWorker({
    connectionString: process.env.MIGRATOR_DATABASE_URL as string,
    jobs: [massRefundJob(provider, { budgetMs: 1 })],
  });
});
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePools();
});

describe('mass refund job (M3.10b, pg-boss)', () => {
  it('one job per run at a time: a second send while it is queued is dropped', async () => {
    await executeCommand(pauseMassRefundCommand, { runId }, a.ctx(), ports);
    // Paused runs are not queued at all.
    expect(await enqueueDueMassRefunds(boss, new Set([a.org.id]))).toBe(0);
    await executeCommand(resumeMassRefundCommand, { runId }, a.ctx(), ports);
    const first = await boss.send(
      MASS_REFUND_JOB,
      { orgId: a.org.id, runId },
      { singletonKey: runId, startAfter: 60 },
    );
    const second = await boss.send(MASS_REFUND_JOB, { orgId: a.org.id, runId }, { singletonKey: runId });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await boss.cancel(MASS_REFUND_JOB, first as string);
  });

  it('the leader tick queues the run until the batch is done and reconciled', async () => {
    await until(async () => {
      await enqueueDueMassRefunds(boss, new Set([a.org.id]));
      return (await status()).status === 'done';
    }, 60_000);
    const s = await status();
    expect(s).toMatchObject({ total: 6, processed: 6, refunded: 6, failed: 0 });
    expect(s.reconciliation).toMatchObject({ reconciled: true });
    expect(await enqueueDueMassRefunds(boss, new Set([a.org.id]))).toBe(0);
    // Finding running runs across orgs is platform access, and audited.
    expect(audited).toContain('system:mass-refunds');
  });
});
