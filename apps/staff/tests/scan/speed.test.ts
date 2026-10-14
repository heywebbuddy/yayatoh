/**
 * Speed (M7.4b): the verdict must come in under 300 ms on a mid-range Android phone. This repeats
 * the M7.1a benchmark through the whole app path (verify the signature, look the ticket up in the
 * manifest, apply the event rules, write the admission and the outbox row to SQLite) over distinct
 * signed codes, and logs the numbers. Node is much faster than Hermes on a phone, so the assertion
 * here is a regression guard with room to spare; the target is checked on a device ("device pass").
 */
import { signTicketCode } from '@yayatoh/ticket-crypto';
import { summarize, TimingLog, VERDICT_BUDGET_MS } from '../../src/scan/timing';
import { FakeServer, NOW, ORG, header, rig, row, ticketId } from './harness';

const N = Number(process.env.BENCH_CODES ?? 300);

describe('verdict speed', () => {
  it('decides each distinct signed code well inside the budget, saving every scan', async () => {
    const rows = Array.from({ length: N + 20 }, (_, i) => row(i + 1));
    const server = new FakeServer({ header: await header(), rows });
    const r = await rig(server, { at: Date.parse('2027-12-01T12:00:00Z'), perfNow: () => performance.now() });
    await r.engine.sync();
    r.clock.ms = Date.parse(NOW);
    const codes = await Promise.all(
      rows.map((x) => signTicketCode({ kid: 1, ticketId: x.ticketId, rev: 0 }, ORG.privateKey)),
    );
    // Warm up (JIT, the first prepared statements), then measure.
    for (let i = 0; i < 20; i++) await r.engine.scan(codes[N + i] as string);
    const log = new TimingLog(N);
    for (let i = 0; i < N; i++) {
      const out = await r.engine.scan(codes[i] as string);
      expect(out.verdict).toBe('admit');
      log.add(out.elapsedMs);
    }
    const s = log.summary();
    console.info(
      `verdict path on Node ${process.version}: ${s.count} codes, mean ${s.mean.toFixed(2)} ms, p95 ${s.p95.toFixed(2)} ms, max ${s.max.toFixed(2)} ms. Device-pass target: every verdict under ${VERDICT_BUDGET_MS} ms on a mid-range Android phone.`,
    );
    expect(s.p95).toBeLessThan(VERDICT_BUDGET_MS / 6);
    expect(r.engine.queueDepth).toBe(N + 20);
    expect(ticketId(1)).toBeTruthy();
  }, 120_000);

  it('summarises timings and checks them against the budget', () => {
    expect(summarize([])).toMatchObject({ count: 0, withinBudget: true });
    expect(summarize([10, 20, 30, 40, 290])).toMatchObject({ count: 5, max: 290, withinBudget: true });
    expect(summarize([10, 301]).withinBudget).toBe(false);
    expect(summarize(Array.from({ length: 100 }, (_, i) => i + 1)).p95).toBe(95);
  });

  it('keeps only the most recent timings', () => {
    const log = new TimingLog(3);
    [1, 2, 3, 4, 5].forEach((n) => log.add(n));
    expect(log.summary()).toMatchObject({ count: 3, max: 5 });
  });
});
