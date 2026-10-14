import { YayatohApiError } from '@yayatoh/sdk';
import { createGuestOutbox, loadGuests, MAX_ARRIVALS_PER_SYNC } from '../../src/tools/guest-checkin';
import { EVENT, fakeStaff, snapshot, testVault } from './fixtures';

const ids = () => {
  let n = 0;
  return () => `c-${++n}`;
};

describe('the guest list', () => {
  it('downloads the list and keeps an encrypted copy', async () => {
    const t = testVault();
    const r = await loadGuests(fakeStaff(), t.vault, EVENT, () => new Date('2026-10-20T08:00:00Z'));
    expect(r).toMatchObject({ source: 'live', savedAt: '2026-10-20T08:00:00.000Z' });
    const file = [...t.files.files.values()][0];
    expect(file).toBeDefined();
    expect(new TextDecoder().decode(file)).not.toContain('Grace');
  });

  it('serves the saved copy when the phone cannot reach the server', async () => {
    const t = testVault();
    await loadGuests(fakeStaff(), t.vault, EVENT);
    const down = fakeStaff({
      guests: async () => {
        throw new TypeError('Network request failed');
      },
    });
    const r = await loadGuests(down, t.vault, EVENT);
    expect(r?.source).toBe('saved');
    expect(r?.snapshot.parties[0]?.guests[0]?.name).toBe('Grace Hopper');
  });

  it('does not serve another event’s saved copy, and answers null with nothing saved', async () => {
    const t = testVault();
    await loadGuests(fakeStaff(), t.vault, 'other-event');
    expect(await loadGuests(null, t.vault, EVENT)).toBeNull();
  });

  it('lets an answer from the server through (a refused device is not "offline")', async () => {
    const t = testVault();
    await loadGuests(fakeStaff(), t.vault, EVENT);
    const refused = fakeStaff({
      guests: async () => {
        throw new YayatohApiError(new Response(null, { status: 401 }), null);
      },
    });
    await expect(loadGuests(refused, t.vault, EVENT)).rejects.toBeInstanceOf(YayatohApiError);
  });
});

describe('the guest check-in outbox', () => {
  const make = (api = fakeStaff(), t = testVault()) => ({
    t,
    api,
    outbox: createGuestOutbox({
      vault: t.vault,
      api,
      eventId: EVENT,
      newId: ids(),
      now: () => new Date('2026-10-20T09:30:00Z'),
      clockOffsetMs: () => 1234.6,
    }),
  });

  it('queues a check-in with its own id and the corrected clock offset, once per guest', async () => {
    const { outbox } = make();
    const a = await outbox.add('g1');
    expect(a).toMatchObject({ clientId: 'c-1', guestId: 'g1', deviceTs: '2026-10-20T09:30:00.000Z', clockOffsetMs: 1235, source: 'scanner' });
    expect(await outbox.add('g1')).toEqual(a);
    expect(await outbox.load()).toHaveLength(1);
  });

  it('sends the queue and empties it', async () => {
    const { outbox, api } = make();
    await outbox.add('g1');
    await outbox.add('g3');
    const r = await outbox.flush();
    expect(r).toMatchObject({ sent: 2, pending: 0, failed: false, already: [], unknown: [] });
    expect(api.recordArrivals).toHaveBeenCalledTimes(1);
    expect(api.recordArrivals.mock.calls[0]?.[1]?.map((a) => a.guestId)).toEqual(['g1', 'g3']);
    expect(await outbox.load()).toEqual([]);
  });

  it('keeps the queue while offline and sends it when the connection is back', async () => {
    let up = false;
    const api = fakeStaff({
      recordArrivals: async (_e, arrivals) => {
        if (!up) throw new TypeError('Network request failed');
        return { results: arrivals.map((a) => ({ clientId: a.clientId, result: 'arrived' as const })) };
      },
    });
    const { outbox } = make(api);
    await outbox.add('g1');
    expect(await outbox.flush()).toMatchObject({ sent: 0, pending: 1, failed: true });
    expect(await outbox.load()).toHaveLength(1);
    up = true;
    expect(await outbox.flush()).toMatchObject({ sent: 1, pending: 0, failed: false });
  });

  it('flags a guest someone else checked in earlier and a guest the event does not know', async () => {
    const api = fakeStaff({
      recordArrivals: async (_e, arrivals) => ({
        results: arrivals.map((a, i) => ({ clientId: a.clientId, result: i === 0 ? ('already' as const) : ('unknown' as const) })),
      }),
    });
    const { outbox } = make(api);
    await outbox.add('g1');
    await outbox.add('gX');
    expect(await outbox.flush()).toMatchObject({ already: ['g1'], unknown: ['gX'], pending: 0 });
  });

  it('sends at most 500 check-ins per request', async () => {
    const { outbox, api } = make();
    for (let i = 0; i < MAX_ARRIVALS_PER_SYNC + 5; i++) await outbox.add(`g${i}`);
    const r = await outbox.flush();
    expect(r.sent).toBe(MAX_ARRIVALS_PER_SYNC + 5);
    expect(api.recordArrivals.mock.calls.map((c) => c[1]?.length)).toEqual([500, 5]);
  });

  it('shares one flush between two taps', async () => {
    const { outbox, api } = make();
    await outbox.add('g1');
    const [a, b] = await Promise.all([outbox.flush(), outbox.flush()]);
    expect(a).toBe(b);
    expect(api.recordArrivals).toHaveBeenCalledTimes(1);
  });

  it('keeps the queue on this phone encrypted', async () => {
    const { outbox, t } = make();
    await outbox.add('g1');
    for (const f of t.files.files.values()) expect(new TextDecoder().decode(f)).not.toContain('g1');
  });

  it('shows a snapshot to search with the engine', () => {
    expect(snapshot().parties).toHaveLength(2);
  });
});
