import {
  batchFileByLink,
  batchLinkQuery,
  createTemplateCommand,
  listBatchesQuery,
  startBatchCommand,
} from '@yayatoh/badges';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { recordBoxOfficeSaleCommand } from '@yayatoh/orders';
import { gotenbergRenderer } from '@yayatoh/pdf';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BADGE_BATCH_JOB, badgeBatchJob, enqueueDueBadgeBatches } from '../src/badges.ts';
import { startWorker } from '../src/worker.ts';

/**
 * M5.5a: a badge batch PDF runs as the pg-boss job `badges.batch`, one job per batch at a time
 * (exclusive queue keyed by the batch), queued again by the leader's tick until it is done.
 */
let a: OrgFixture;
let eventId: string;
let batchId: string;
let boss: PgBoss;
const audited: string[] = [];

async function until(check: () => Promise<boolean>, ms = 60_000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 200));
  }
}

const batch = async () =>
  (await executeQuery(listBatchesQuery, { eventId, limit: 50 }, a.ctx(), ports)).find(
    (b) => b.id === batchId,
  );

beforeAll(async () => {
  setPlatformAuditSink(async ({ actor }) => void audited.push(actor));
  ({ a } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Worker Badges',
        profile: 'conference',
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
      { eventId, name: 'Delegate', priceMinor: 0, quantityTotal: 500, maxPerOrder: 100 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  for (let i = 0; i < 3; i++)
    await executeCommand(
      recordBoxOfficeSaleCommand,
      {
        eventId,
        items: [{ ticketTypeId: typeId, quantity: 100 }],
        buyer: { email: `w${i}@badges.test`, name: `Walk Up ${i}` },
        method: 'cash',
      },
      a.ctx(),
      ports,
    );
  await executeCommand(
    createTemplateCommand,
    { eventId, name: 'Delegate', size: 'label_4x6' },
    a.ctx(),
    ports,
  );
  batchId = (
    await executeCommand(
      startBatchCommand,
      { eventId, requestKey: `worker-${Date.now()}`, sort: 'last_name' },
      a.ctx(),
      ports,
    )
  ).id;
  // A tiny budget: each job renders about one chunk, then the tick queues the next.
  boss = await startWorker({
    connectionString: process.env.MIGRATOR_DATABASE_URL as string,
    jobs: [
      badgeBatchJob(gotenbergRenderer({ url: process.env.GOTENBERG_URL ?? 'http://localhost:3300' }), {
        budgetMs: 1,
      }),
    ],
  });
}, 120_000);

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePools();
});

describe('badge batch job (M5.5a, pg-boss)', { timeout: 120_000 }, () => {
  it('one job per batch at a time: a second send while it is queued is dropped', async () => {
    const first = await boss.send(
      BADGE_BATCH_JOB,
      { orgId: a.org.id, batchId },
      { singletonKey: batchId, startAfter: 60 },
    );
    const second = await boss.send(BADGE_BATCH_JOB, { orgId: a.org.id, batchId }, { singletonKey: batchId });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await boss.cancel(BADGE_BATCH_JOB, first as string);
  });

  it('the leader tick queues the batch until its PDF is done', async () => {
    await until(async () => {
      await enqueueDueBadgeBatches(boss, new Set([a.org.id]));
      return (await batch())?.status === 'done';
    });
    expect(await batch()).toMatchObject({ total: 300, processed: 300, hasFile: true });
    expect(await enqueueDueBadgeBatches(boss, new Set([a.org.id]))).toBe(0);
    const link = await executeQuery(batchLinkQuery, { eventId, batchId }, a.ctx(), ports);
    const file = await batchFileByLink(link.token);
    expect(new TextDecoder().decode(file?.bytes.slice(0, 5))).toBe('%PDF-');
    // Finding unfinished batches across orgs is platform access, and audited.
    expect(audited).toContain('system:badge-batches');
  });
});
