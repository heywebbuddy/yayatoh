import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { uuidv7 } from '@yayatoh/kernel';
import { processedPairsTx } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * Batch 3f merge: the dev drain skips (consumer, event) pairs already handled in one query
 * (`processedPairsTx`) instead of a transaction per pair. It must name exactly the handled pairs,
 * and only the org's own (row-level security).
 */
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(async () => {
  await closePools();
});

describe('processedPairsTx', () => {
  it('names the handled (consumer, event) pairs of the given events, in this org only', async () => {
    const [e1, e2, e3] = [uuidv7(), uuidv7(), uuidv7()];
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`insert into platform.processed_events (org_id, consumer, event_id) values
        (${a.org.id}, 'test.one', ${e1}), (${a.org.id}, 'test.two', ${e1}), (${a.org.id}, 'test.one', ${e2})`),
    );
    const mine = await withTenant(systemCtx(a.org.id), (tx) => processedPairsTx(tx, [e1, e3]));
    expect([...mine].sort()).toEqual([`test.one ${e1}`, `test.two ${e1}`]);
    expect(await withTenant(systemCtx(a.org.id), (tx) => processedPairsTx(tx, []))).toEqual(new Set());
    // Another org's drain sees none of them.
    expect(await withTenant(systemCtx(b.org.id), (tx) => processedPairsTx(tx, [e1, e2]))).toEqual(new Set());
  });
});
