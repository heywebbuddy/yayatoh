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

  it('logs backfilled (replayed) events but never delivers them (M2.2c, ADR 0008)', async () => {
    const { a } = await twoOrgs();
    const [ev] = await admin<{ id: string }[]>`
      insert into platform.domain_events (org_id, type, version, aggregate_type, aggregate_id, payload, actor, request_id, replayed)
      values (${a.org.id}, 'organization.updated', 1, 'organization', ${a.org.id}, '{}'::jsonb, 'legacy:yay', 'legacy-backfill:test', true)
      returning id`;
    await drain();
    const [row] = await admin<{ log_seq: string | null; published: boolean }[]>`
      select log_seq, published_at is not null as published from platform.domain_events where id = ${ev?.id ?? ''}`;
    expect(row?.log_seq).not.toBeNull();
    expect(row?.published).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    expect(seen.some((e) => e.id === ev?.id)).toBe(false);
    // Handed to the subscriber directly (a catch-up, a stale queued job): skipped and recorded.
    const replay = {
      id: ev?.id ?? '',
      orgId: a.org.id,
      type: 'organization.updated',
      version: 1,
      aggregateType: 'organization',
      aggregateId: a.org.id,
      payload: {},
      logSeq: 0,
    };
    expect(await consumeEvent(recorder, replay)).toBe(false);
    expect(seen.some((e) => e.id === ev?.id)).toBe(false);
    const [done] = await admin<{ n: number }[]>`
      select count(*)::int as n from platform.processed_events where event_id = ${ev?.id ?? ''} and consumer = 'test.recorder'`;
    expect(done?.n).toBe(1);
  });
});
