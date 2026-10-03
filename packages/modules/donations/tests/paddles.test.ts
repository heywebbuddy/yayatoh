import { describe, expect, it } from 'vitest';
import {
  emptyQueue,
  enqueue,
  nextBatch,
  type QueuedEntry,
  restoreQueue,
  SETTLED_KEPT,
  type SpotterQueue,
  settle,
} from '../src/domain/paddle-queue.ts';
import {
  callTotals,
  type EntryOutcome,
  type EntryStatus,
  entryStatusFor,
  nextPaddleNumbers,
  parsePaddleNumber,
  undoStep,
} from '../src/domain/paddles.ts';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const CALL = uuid(999_999);
const entry = (n: number, paddle = 100 + n, callId = CALL): QueuedEntry => ({
  clientId: uuid(n),
  callId,
  paddle,
  recordedAt: new Date(1_790_000_000_000 + n * 1000).toISOString(),
});

describe('paddle numbers (M4.8c)', () => {
  it('reads a typed number, or refuses what is not one', () => {
    expect(parsePaddleNumber('12')).toBe(12);
    expect(parsePaddleNumber(' 012 ')).toBe(12);
    expect(parsePaddleNumber('99999')).toBe(99_999);
    for (const bad of ['', '0', '100000', '1.5', '-3', 'abc', '12a', '١٢'])
      expect(parsePaddleNumber(bad), bad).toBeNull();
  });

  it('hands out the next free numbers from the start, skipping taken ones', () => {
    expect(nextPaddleNumbers([], 3)).toEqual([100, 101, 102]);
    expect(nextPaddleNumbers([100, 102], 3)).toEqual([101, 103, 104]);
    expect(nextPaddleNumbers([5], 2, 4)).toEqual([4, 6]);
    expect(nextPaddleNumbers([], 3, 99_998)).toEqual([99_998, 99_999]);
  });

  it('flags a second entry of the same paddle at the same call as a duplicate', () => {
    expect(entryStatusFor([])).toBe('recorded');
    expect(entryStatusFor(['voided'])).toBe('recorded');
    expect(entryStatusFor(['recorded'])).toBe('duplicate');
    expect(entryStatusFor(['confirmed', 'voided'])).toBe('duplicate');
    expect(entryStatusFor(['duplicate'])).toBe('duplicate');
  });

  it('counts recorded and confirmed entries; duplicates and voided ones aside', () => {
    const s: EntryStatus[] = ['recorded', 'confirmed', 'duplicate', 'voided', 'recorded'];
    expect(callTotals(100_000, s)).toEqual({
      count: 3,
      totalMinor: 300_000,
      duplicates: 1,
      confirmed: 1,
    });
  });

  it('undo: voids the newest waiting entry, withdraws an empty arm, reopens a closed level', () => {
    expect(undoStep(null, [])).toEqual({ kind: 'nothing' });
    expect(undoStep({ status: 'withdrawn' }, [])).toEqual({ kind: 'nothing' });
    expect(undoStep({ status: 'closed' }, [{ id: 'a', status: 'recorded' }])).toEqual({
      kind: 'reopen_call',
    });
    expect(undoStep({ status: 'open' }, [])).toEqual({ kind: 'withdraw_call' });
    expect(undoStep({ status: 'open' }, [{ id: 'a', status: 'voided' }])).toEqual({ kind: 'withdraw_call' });
    expect(
      undoStep({ status: 'open' }, [
        { id: 'c', status: 'confirmed' },
        { id: 'b', status: 'duplicate' },
        { id: 'a', status: 'recorded' },
      ]),
    ).toEqual({ kind: 'void_entry', entryId: 'b' });
    // Only confirmed pledges left: undo never cancels a pledge.
    expect(undoStep({ status: 'open' }, [{ id: 'c', status: 'confirmed' }])).toEqual({ kind: 'nothing' });
  });
});

describe('the spotter queue (M4.8c)', () => {
  it('keeps entries until the server answers them, and ignores a double Enter', () => {
    let q = emptyQueue();
    q = enqueue(q, entry(1));
    q = enqueue(q, entry(1));
    q = enqueue(q, entry(2));
    expect(q.pending.map((e) => e.paddle)).toEqual([101, 102]);
    // The server answered only the first: the second stays queued.
    q = settle(q, [{ clientId: uuid(1), outcome: { status: 'recorded' } }]);
    expect(q.pending.map((e) => e.paddle)).toEqual([102]);
    expect(q.settled.map((e) => e.paddle)).toEqual([101]);
    // An answered id typed again (a replay from storage) is not queued again.
    expect(enqueue(q, entry(1))).toBe(q);
    q = settle(q, [
      { clientId: uuid(2), outcome: { status: 'refused', reason: 'paddle_unknown' } },
      { clientId: uuid(77), outcome: { status: 'recorded' } },
    ]);
    expect(q.pending).toEqual([]);
    expect(q.settled.map((e) => [e.paddle, e.outcome.status])).toEqual([
      [102, 'refused'],
      [101, 'recorded'],
    ]);
  });

  it('sends batches oldest first and keeps the last answers only', () => {
    let q = emptyQueue();
    for (let i = 1; i <= 130; i++) q = enqueue(q, entry(i));
    expect(nextBatch(q).length).toBe(100);
    expect(nextBatch(q)[0]?.paddle).toBe(101);
    q = settle(
      q,
      nextBatch(q).map((e) => ({ clientId: e.clientId, outcome: { status: 'recorded' } as const })),
    );
    expect(q.pending.length).toBe(30);
    expect(q.settled.length).toBe(SETTLED_KEPT);
    expect(q.settled[0]?.paddle).toBe(200);
  });

  it('restores from storage and drops anything malformed', () => {
    let q = enqueue(emptyQueue(), entry(1));
    q = enqueue(q, entry(2));
    q = settle(q, [{ clientId: uuid(1), outcome: { status: 'duplicate' } }]);
    expect(restoreQueue(JSON.stringify(q))).toEqual(q);
    expect(restoreQueue(null)).toEqual(emptyQueue());
    expect(restoreQueue('{not json')).toEqual(emptyQueue());
    const broken = {
      pending: [entry(3), { ...entry(4), paddle: 0 }, { ...entry(5), clientId: 'x' }, null],
      settled: [{ ...entry(6) }],
    };
    expect(restoreQueue(JSON.stringify(broken))).toEqual({ pending: [entry(3)], settled: [] });
  });

  it('30 spotters, 400 paddles, half offline for 2 minutes and lost answers: no loss, no duplicates', () => {
    // A server with the command's exactly-once rule: a known client id gets its first answer back.
    const stored = new Map<string, QueuedEntry>();
    const answered = new Map<string, EntryOutcome>();
    const server = (batch: readonly QueuedEntry[]) =>
      batch.map((e) => {
        let outcome = answered.get(e.clientId);
        if (!outcome) {
          stored.set(e.clientId, e);
          outcome = { status: 'recorded' };
          answered.set(e.clientId, outcome);
        }
        return { clientId: e.clientId, outcome };
      });
    const spotters: SpotterQueue[] = Array.from({ length: 30 }, () => emptyQueue());
    let n = 0;
    for (let paddle = 100; paddle < 500; paddle++) {
      const s = paddle % 30;
      spotters[s] = enqueue(spotters[s] as SpotterQueue, entry(++n, paddle));
    }
    const online = (i: number) => i % 2 === 0;
    // Online spotters sync in small batches; every third answer is lost on the way back.
    let round = 0;
    const syncAll = (who: (i: number) => boolean) => {
      for (let i = 0; i < spotters.length; i++) {
        if (!who(i)) continue;
        let q = spotters[i] as SpotterQueue;
        while (q.pending.length > 0) {
          const batch = nextBatch(q, 4);
          const results = server(batch);
          if (++round % 3 === 0) continue; // the response never arrived: the batch goes again
          q = settle(q, results);
        }
        spotters[i] = q;
      }
    };
    syncAll(online);
    expect(spotters.filter((_, i) => !online(i)).every((q) => q.pending.length > 0)).toBe(true);
    // Two minutes later the offline half comes back.
    syncAll((i) => !online(i));
    expect(spotters.every((q) => q.pending.length === 0)).toBe(true);
    expect(stored.size).toBe(400);
    expect(new Set([...stored.values()].map((e) => e.paddle)).size).toBe(400);
  });
});
