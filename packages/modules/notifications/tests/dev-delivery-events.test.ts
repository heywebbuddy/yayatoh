import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { releaseDevDeliveryEvent, settleDevDeliveryEvents, takeDevDeliveryEvents } from '../src/index.ts';

/**
 * Batch 3g merge: the dev drain's fake delivery reports. A report is taken once; it stays claimed
 * until its taker posted it, and a drain waits for other drains' claims before it returns (a
 * concurrent drain that took a report must not let the sender read its bounce too early).
 */
const folderWith = (...names: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'dev-mailbox-'));
  const events = join(dir, 'delivery-events');
  mkdirSync(events, { recursive: true });
  for (const n of names)
    writeFileSync(join(events, `${n}.json`), JSON.stringify({ body: n, signature: 's' }));
  return { dir, events };
};

describe('dev delivery reports', () => {
  it('are taken once, stay claimed until released, and settle waits for claims', async () => {
    const { dir, events } = folderWith('a', 'b');
    const taken = takeDevDeliveryEvents(dir);
    expect(taken.map((t) => t.body)).toEqual(['a', 'b']);
    expect(takeDevDeliveryEvents(dir)).toEqual([]);
    expect(readdirSync(events).filter((f) => f.endsWith('.claimed'))).toHaveLength(2);
    // Still claimed: settling gives up at its bound.
    expect(await settleDevDeliveryEvents(dir, 150)).toBe(false);
    // Released while another drain waits: it settles.
    const waiting = settleDevDeliveryEvents(dir, 5_000);
    for (const t of taken) releaseDevDeliveryEvent(t.claimed);
    expect(await waiting).toBe(true);
    expect(readdirSync(events)).toEqual([]);
  });

  it('ignores a claim left behind by a process that died (older than a minute)', async () => {
    const { dir } = folderWith('c');
    const [t] = takeDevDeliveryEvents(dir);
    const old = new Date(Date.now() - 120_000);
    utimesSync(t?.claimed as string, old, old);
    expect(await settleDevDeliveryEvents(dir, 150)).toBe(true);
  });
});
