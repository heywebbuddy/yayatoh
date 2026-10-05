import { hashKioskPin } from '@yayatoh/checkin';
import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_BUDGET_MS,
  FEEDBACK_MEASURE,
  feedbackSummary,
  markScanFeedback,
  markScanStart,
} from '../src/scan/feedback.ts';
import { PIN_LOCK_MS, PIN_MAX_ATTEMPTS, pinLockedUntil, verifyPinHash } from '../src/scan/kiosk-pin.ts';
import { chunk, dedupeQueue, isNewDirective, singleFlight } from '../src/scan/sync-queue.ts';

describe('Scan PWA sync queue (M3.4a)', () => {
  it('batches of at most 500', () => {
    const items = Array.from({ length: 1201 }, (_, i) => i);
    expect(chunk(items, 500).map((b) => b.length)).toEqual([500, 500, 201]);
    expect(chunk([], 500)).toEqual([]);
    expect(() => chunk(items, 0)).toThrow();
  });

  it('dedupes by scan id and orders by device time', () => {
    const q = [
      { scanId: 'b', deviceTs: '2027-12-01T20:00:02Z' },
      { scanId: 'a', deviceTs: '2027-12-01T20:00:01Z' },
      { scanId: 'b', deviceTs: '2027-12-01T20:00:09Z' },
    ];
    expect(dedupeQueue(q).map((s) => `${s.scanId}@${s.deviceTs.slice(17, 19)}`)).toEqual(['a@01', 'b@02']);
  });

  it('single flight: concurrent flushes share one run; the next call runs again', async () => {
    let runs = 0;
    let release: () => void = () => {};
    const flush = singleFlight(async () => {
      runs += 1;
      await new Promise<void>((r) => {
        release = r;
      });
      return runs;
    });
    const a = flush();
    const b = flush();
    release();
    expect(await a).toBe(1);
    expect(await b).toBe(1);
    const c = flush();
    release();
    expect(await c).toBe(2);
  });

  it('a failed run releases the lock', async () => {
    let n = 0;
    const flush = singleFlight(async () => {
      n += 1;
      if (n === 1) throw new Error('offline');
      return n;
    });
    await expect(flush()).rejects.toThrow('offline');
    expect(await flush()).toBe(2);
  });

  it('supervisor directives apply once: only a newer request is new', () => {
    expect(isNewDirective(null, null)).toBe(false);
    expect(isNewDirective('2027-12-01T20:00:00Z', null)).toBe(true);
    expect(isNewDirective('2027-12-01T20:00:00Z', '2027-12-01T20:00:00.000Z')).toBe(false);
    expect(isNewDirective('2027-12-01T20:00:01Z', '2027-12-01T20:00:00Z')).toBe(true);
  });
});

describe('scan feedback timing', () => {
  it('measures start → feedback under one measure name, once per mark', () => {
    const marks = new Map<string, number>();
    const measures: { name: string; duration: number }[] = [];
    let clock = 1000;
    const perf = {
      mark: (n: string) => {
        marks.set(n, clock);
        return undefined as never;
      },
      measure: (name: string, o: { start: string }) => {
        const m = { name, duration: clock - (marks.get(o.start) ?? 0) };
        measures.push(m);
        return m as never;
      },
      getEntriesByName: (n: string) => (marks.has(n) ? [{} as never] : []),
      clearMarks: (n?: string) => {
        if (n) marks.delete(n);
      },
    };
    markScanStart('s1', perf);
    clock += 42;
    expect(markScanFeedback('s1', perf)).toBe(42);
    expect(markScanFeedback('s1', perf)).toBeNull();
    expect(measures).toEqual([{ name: FEEDBACK_MEASURE, duration: 42 }]);
  });

  it('summarises against the 300 ms budget', () => {
    expect(feedbackSummary([])).toEqual({ count: 0, max: 0, p95: 0, withinBudget: true });
    const s = feedbackSummary([...Array.from({ length: 19 }, () => 20), 290]);
    expect(s).toMatchObject({ count: 20, max: 290, withinBudget: true });
    expect(s.p95).toBe(20);
    expect(feedbackSummary([FEEDBACK_BUDGET_MS + 1]).withinBudget).toBe(false);
  });
});

describe('kiosk PIN on the device', () => {
  it('checks the server’s PBKDF2 hash with WebCrypto (offline)', async () => {
    const stored = hashKioskPin('482915');
    expect(await verifyPinHash('482915', stored)).toBe(true);
    expect(await verifyPinHash('482916', stored)).toBe(false);
    expect(await verifyPinHash('12', stored)).toBe(false);
    expect(await verifyPinHash('482915', 'md5$1$x$y')).toBe(false);
  });

  it('locks the pad for 30 s after 5 wrong PINs', () => {
    expect(pinLockedUntil(PIN_MAX_ATTEMPTS - 1, 1000)).toBeNull();
    expect(pinLockedUntil(PIN_MAX_ATTEMPTS, 1000)).toBe(1000 + PIN_LOCK_MS);
  });
});
