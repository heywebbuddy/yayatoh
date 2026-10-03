import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { uuidv7 } from '@yayatoh/kernel';
import { consumeEvent, defineSubscriber, type PublishedEvent, processedPairsTx } from '@yayatoh/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * Batch 3g merge: the dev drain reads which events its subscribers already handled in one query
 * (`processedPairsTx`) instead of one transaction per event and subscriber. The answer is exactly
 * the handled pairs, per consumer, in the caller's org only.
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
});
