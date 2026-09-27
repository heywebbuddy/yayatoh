import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { executeCommand } from '@yayatoh/kernel';
import { consumeEvent, defineSubscriber, type PublishedEvent } from '@yayatoh/platform';
import { updateOrganizationCommand } from '@yayatoh/tenancy';
import { ports, twoOrgs } from '@yayatoh/testing';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relayOnce } from '../src/relay.ts';
import { startWorker } from '../src/worker.ts';

const seen: PublishedEvent[] = [];
const audited: string[] = [];
const recorder = defineSubscriber({
  name: 'test.recorder',
  events: ['organization.updated@1', 'membership.added@1'],
  handle: async (_tx, e) => void seen.push(e),
});

let boss: PgBoss;
let admin: AdminSql;

beforeAll(async () => {
  setPlatformAuditSink(async ({ actor }) => void audited.push(actor));
  admin = adminClient();
  boss = await startWorker({
    connectionString: process.env.MIGRATOR_DATABASE_URL as string,
    jobs: [],
    subscribers: [recorder],
  });
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await closePools();
  await admin.end();
});

async function drain() {
  let n = 1;
  while (n > 0) {
    // Two relays racing must still produce one gap-free sequence.
    const [x, y] = await Promise.all([relayOnce(boss, [recorder], 7), relayOnce(boss, [recorder], 7)]);
    n = x + y;
  }
}

describe('outbox relay', () => {
  it('stamps a gap-free log_seq, publishes every event and delivers to subscribers', async () => {
    const { a, b } = await twoOrgs();
    for (let i = 0; i < 5; i++) {
      await executeCommand(updateOrganizationCommand, { name: `Alpha ${i}` }, a.ctx(), ports);
      await executeCommand(updateOrganizationCommand, { name: `Bravo ${i}` }, b.ctx(), ports);
    }
    await drain();

    const rows = await admin<{ log_seq: string; published: boolean }[]>`
      select log_seq, published_at is not null as published from platform.domain_events order by log_seq`;
    const seqs = rows.map((r) => Number(r.log_seq));
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    expect(rows.every((r) => r.published)).toBe(true);
    expect(audited).toContain('system:relay');

    const expected = await admin<{ n: number }[]>`
      select count(*)::int as n from platform.domain_events where type in ('organization.updated', 'membership.added')`;
    const deadline = Date.now() + 20_000;
    while (seen.length < (expected[0]?.n ?? 0) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 200));
    expect(seen.length).toBe(expected[0]?.n);
    expect(new Set(seen.map((e) => e.id)).size).toBe(seen.length);
    expect(seen.filter((e) => e.orgId === a.org.id && e.type === 'organization.updated').length).toBe(6);
  });

  it('consumers are idempotent under replay', async () => {
    const event = seen[0] as PublishedEvent;
    const before = seen.length;
    expect(await consumeEvent(recorder, event)).toBe(false);
    expect(seen.length).toBe(before);
  });
});
