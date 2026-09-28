import { describe, expect, it, vi } from 'vitest';
import { memoryRealtimeHub, type RealtimeMessage } from '../src/realtime.ts';
import { createRealtimeFanout, type LoggedMessage } from '../src/realtime-log.ts';

const A = '0190a000-0000-7000-8000-00000000000a';
const B = '0190b000-0000-7000-8000-00000000000b';
const E = '0190e000-0000-7000-8000-00000000000e';
const CA = `org:${A}:event:${E}:checkins`;
const CB = `org:${B}:alerts`;

/** A fake log: seq → (channel, message). */
function fakeLog() {
  const rows = new Map<number, LoggedMessage & { orgId: string }>();
  const loads: { orgId: string; seqs: number[] }[] = [];
  return {
    rows,
    loads,
    add(orgId: string, channel: string, seq: number) {
      rows.set(seq, { orgId, channel, message: { id: String(seq), event: 'admission', data: { seq } } });
      return `${seq} ${channel}`;
    },
    load: async (orgId: string, seqs: readonly number[]) => {
      loads.push({ orgId, seqs: [...seqs] });
      // Under RLS only the org's own rows come back.
      return seqs.flatMap((s) => {
        const r = rows.get(s);
        return r && r.orgId === orgId ? [{ channel: r.channel, message: r.message }] : [];
      });
    },
    replay: async (orgId: string, channel: string, after: number): Promise<RealtimeMessage[]> =>
      [...rows.entries()]
        .filter(([s, r]) => r.orgId === orgId && r.channel === channel && s > after)
        .sort(([x], [y]) => x - y)
        .map(([, r]) => r.message),
  };
}

describe('realtime fan-out (M3.1b)', () => {
  it('fetches notified messages by id in one query per org and delivers them in id order', async () => {
    const hub = memoryRealtimeHub();
    const log = fakeLog();
    const got: string[] = [];
    hub.subscribe(CA, (m) => got.push(m.id));
    const fanout = createRealtimeFanout({ hub, load: log.load, replay: log.replay, batchMs: 1 });
    fanout.notify(log.add(A, CA, 3));
    fanout.notify(log.add(A, CA, 2));
    fanout.notify(log.add(A, CA, 4));
    await fanout.idle();
    expect(got).toEqual(['2', '3', '4']);
    expect(log.loads).toEqual([{ orgId: A, seqs: [2, 3, 4] }]);
  });

  it('never fetches channels nobody here follows, and ignores malformed notifications', async () => {
    const hub = memoryRealtimeHub();
    const log = fakeLog();
    const fanout = createRealtimeFanout({ hub, load: log.load, replay: log.replay, batchMs: 1 });
    fanout.notify(log.add(B, CB, 1));
    for (const bad of ['', 'x', '1', `0 ${CA}`, `1 public:x`, `1 org:nope:alerts`, `abc ${CA}`, `1  ${CA}`])
      fanout.notify(bad);
    await fanout.idle();
    expect(log.loads).toEqual([]);
  });

  it('with an extra publisher (Ably) every message is fetched and published there too', async () => {
    const hub = memoryRealtimeHub();
    const log = fakeLog();
    const publish = vi.fn(async () => {});
    const fanout = createRealtimeFanout({
      hub,
      load: log.load,
      replay: log.replay,
      batchMs: 1,
      publisher: { publish },
    });
    fanout.notify(log.add(B, CB, 1));
    await fanout.idle();
    expect(publish).toHaveBeenCalledWith(CB, { id: '1', event: 'admission', data: { seq: 1 } });
  });

  it('a row that does not belong to the notified org is never delivered', async () => {
    const hub = memoryRealtimeHub();
    const got: string[] = [];
    hub.subscribe(CA, (m) => got.push(m.id));
    // A loader that (wrongly) returns another org's channel for org B's batch.
    const fanout = createRealtimeFanout({
      hub,
      batchMs: 1,
      load: async () => [{ channel: CA, message: { id: '1', event: 'admission', data: {} } }],
      replay: async () => [],
    });
    fanout.notify(`1 org:${B}:event:${E}:checkins`);
    hub.subscribe(`org:${B}:event:${E}:checkins`, () => {});
    fanout.notify(`1 org:${B}:event:${E}:checkins`);
    await fanout.idle();
    expect(got).toEqual([]);
  });

  it('delivers out-of-order commits, never the same message twice, and replays after a reconnect', async () => {
    const hub = memoryRealtimeHub();
    const log = fakeLog();
    const got: string[] = [];
    hub.subscribe(CA, (m) => got.push(m.id));
    const fanout = createRealtimeFanout({ hub, load: log.load, replay: log.replay, batchMs: 1 });
    fanout.notify(log.add(A, CA, 6));
    await fanout.idle();
    // Seq 5 committed after 6 (concurrent publishers): still new here.
    fanout.notify(log.add(A, CA, 5));
    fanout.notify(`6 ${CA}`);
    await fanout.idle();
    expect(got).toEqual(['6', '5']);
    // The LISTEN connection dropped while 7 and 8 were published: the resync replays them once.
    log.add(A, CA, 7);
    log.add(A, CA, 8);
    fanout.resync();
    await fanout.idle();
    fanout.notify(`8 ${CA}`);
    await fanout.idle();
    expect(got).toEqual(['6', '5', '7', '8']);
    fanout.close();
    fanout.notify(log.add(A, CA, 9));
    await fanout.idle();
    expect(got).toEqual(['6', '5', '7', '8']);
  });

  it('a failing fetch is logged and does not stop later deliveries', async () => {
    const hub = memoryRealtimeHub();
    const log = fakeLog();
    const got: string[] = [];
    hub.subscribe(CA, (m) => got.push(m.id));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fail = true;
    const fanout = createRealtimeFanout({
      hub,
      batchMs: 1,
      replay: log.replay,
      load: async (o, s) => {
        if (fail) {
          fail = false;
          throw new Error('boom');
        }
        return log.load(o, s);
      },
    });
    fanout.notify(log.add(A, CA, 1));
    await fanout.idle();
    fanout.notify(log.add(A, CA, 2));
    await fanout.idle();
    expect(got).toEqual(['2']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
