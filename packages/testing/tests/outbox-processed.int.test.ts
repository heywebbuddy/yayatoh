import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { uuidv7 } from '@yayatoh/kernel';
import { consumeEvent, defineSubscriber, type PublishedEvent, processedPairsTx } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * Batch 3g merge: the dev drain reads which events its subscribers already handled in one query
 * (`processedPairsTx`) instead of one transaction per event and subscriber. The answer is exactly
 * the handled pairs, per consumer, in the caller's org only.
 * Batch 3f merge (same helper, its test kept): the pairs named are only the given events', and
 * only the org's own (row-level security).
 */
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const event = (f: OrgFixture): PublishedEvent => ({
  id: uuidv7(),
  orgId: f.org.id,
  type: 'test.pinged',
  version: 1,
  aggregateType: 'test',
  aggregateId: uuidv7(),
  payload: { orgId: f.org.id },
  logSeq: 0,
  occurredAt: new Date().toISOString(),
});

describe('processedPairsTx', () => {
  it('returns exactly the handled (consumer, event) pairs, in the caller’s org only', async () => {
    const handled: string[] = [];
    const sub = defineSubscriber({
      name: 'testing.processed-pairs',
      events: ['test.pinged@1'],
      handle: async (_tx, e) => {
        handled.push(e.id);
      },
    });
    const [e1, e2] = [event(a), event(a)] as [PublishedEvent, PublishedEvent];
    expect(await consumeEvent(sub, e1)).toBe(true);
    const pairs = (orgId: string) =>
      withTenant(systemCtx(orgId), (tx) => processedPairsTx(tx, [sub.name, 'testing.other'], [e1.id, e2.id]));
    expect([...(await pairs(a.org.id))]).toEqual([`${sub.name}|${e1.id}`]);
    // Another org reads none of them (RLS), and an empty question asks nothing.
    expect((await pairs(b.org.id)).size).toBe(0);
    expect((await withTenant(systemCtx(a.org.id), (tx) => processedPairsTx(tx, [sub.name], []))).size).toBe(
      0,
    );
    // The guard is still consumeEvent: the handled one is never run again.
    expect(await consumeEvent(sub, e1)).toBe(false);
    expect(await consumeEvent(sub, e2)).toBe(true);
    expect(handled).toEqual([e1.id, e2.id]);
    expect((await pairs(a.org.id)).size).toBe(2);
  });

  it('names the handled (consumer, event) pairs of the given events, in this org only', async () => {
    const [e1, e2, e3] = [uuidv7(), uuidv7(), uuidv7()];
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`insert into platform.processed_events (org_id, consumer, event_id) values
        (${a.org.id}, 'test.one', ${e1}), (${a.org.id}, 'test.two', ${e1}), (${a.org.id}, 'test.one', ${e2})`),
    );
    const mine = await withTenant(systemCtx(a.org.id), (tx) =>
      processedPairsTx(tx, ['test.one', 'test.two'], [e1, e3]),
    );
    expect([...mine].sort()).toEqual([`test.one|${e1}`, `test.two|${e1}`]);
    expect(await withTenant(systemCtx(a.org.id), (tx) => processedPairsTx(tx, ['test.one'], []))).toEqual(
      new Set(),
    );
    // Another org's drain sees none of them.
    expect(
      await withTenant(systemCtx(b.org.id), (tx) => processedPairsTx(tx, ['test.one', 'test.two'], [e1, e2])),
    ).toEqual(new Set());
  });
});
