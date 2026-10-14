import { QueryClient } from '@tanstack/react-query';
import { ticketKeys } from '../src/tickets/api';
import { detailIsCurrent, MAX_SYNC_PAGES, syncTickets } from '../src/tickets/sync';
import { setOnline, setup, teardown } from './helpers/app';
import { IDS, page, summary, ticket } from './helpers/fixtures';
import { problem } from './helpers/server';

const apps: ReturnType<typeof setup>[] = [];
function mount() {
  const app = setup();
  apps.push(app);
  return app;
}
afterEach(() => {
  setOnline(true);
  teardown(apps);
});

describe('detailIsCurrent', () => {
  it('compares the revision, the status and the pending-transfer flag', () => {
    const s = summary();
    expect(detailIsCurrent(undefined, s)).toBe(false);
    expect(detailIsCurrent(ticket(), s)).toBe(true);
    expect(detailIsCurrent(ticket({ rev: 2 }), s)).toBe(false);
    expect(detailIsCurrent(ticket({ status: 'void' }), s)).toBe(false);
    expect(detailIsCurrent(ticket(), { ...s, pendingTransfer: true })).toBe(false);
    expect(
      detailIsCurrent(ticket({ transfer: { ...ticket().transfer, pendingTransferId: IDS.transfer } }), {
        ...s,
        pendingTransfer: true,
      }),
    ).toBe(true);
  });
});

describe('syncTickets', () => {
  it('does nothing while the phone is offline, and says so', async () => {
    const app = mount();
    setOnline(false);
    await app.ready;
    expect(await syncTickets({ api: app.core.api, queryClient: app.core.queryClient })).toEqual({
      kind: 'offline',
    });
    expect(app.server.callsTo('GET /v1/me/tickets')).toHaveLength(0);
  });

  it('walks every page of upcoming tickets (keyset cursors) and the first page of past ones', async () => {
    const app = mount();
    app.server.on('GET /v1/me/tickets', (c) => {
      if (c.query.get('when') === 'past') return page([summary({ id: IDS.t4, serial: 4 })], 'past-2');
      const cursor = c.query.get('cursor');
      if (!cursor) return page([summary({ id: IDS.t1 })], 'c1');
      if (cursor === 'c1') return page([summary({ id: IDS.t2, serial: 2 })], 'c2');
      return page([summary({ id: IDS.t3, serial: 3 })]);
    });
    app.server.on('GET /v1/me/tickets/:id', (_c, p) => ticket({ id: p.id as string }));
    await app.ready;
    const result = await syncTickets({
      api: app.core.api,
      queryClient: app.core.queryClient,
      now: () => new Date('2030-01-01T00:00:00Z'),
    });
    expect(result).toEqual({ kind: 'synced', at: '2030-01-01T00:00:00.000Z', failedDetails: 0 });
    const upcoming = app.core.queryClient.getQueryData<{ pages: { data: { id: string }[] }[] }>(
      ticketKeys.list('upcoming'),
    );
    expect(upcoming?.pages.flatMap((p) => p.data.map((t) => t.id))).toEqual([IDS.t1, IDS.t2, IDS.t3]);
    const past = app.core.queryClient.getQueryData<{ pages: { nextCursor: string | null }[] }>(
      ticketKeys.list('past'),
    );
    // The past list keeps its cursor so scrolling can load the rest.
    expect(past?.pages[0]?.nextCursor).toBe('past-2');
    for (const id of [IDS.t1, IDS.t2, IDS.t3, IDS.t4])
      expect(app.core.queryClient.getQueryData(ticketKeys.detail(id))).toBeDefined();
    expect(
      app.server.callsTo('GET /v1/me/tickets').filter((c) => c.query.get('when') === 'past'),
    ).toHaveLength(1);
  });

  it('stops at the page cap if a cursor never ends', async () => {
    const app = mount();
    let n = 0;
    app.server.on('GET /v1/me/tickets', (c) =>
      c.query.get('when') === 'past' ? page([]) : page([summary({ id: IDS.t1 })], `c${++n}`),
    );
    app.server.on('GET /v1/me/tickets/:id', () => ticket());
    await app.ready;
    await syncTickets({ api: app.core.api, queryClient: app.core.queryClient });
    expect(
      app.server.callsTo('GET /v1/me/tickets').filter((c) => c.query.get('when') === 'upcoming'),
    ).toHaveLength(MAX_SYNC_PAGES);
  });

  it('fetches at most four ticket records at a time', async () => {
    const app = mount();
    const ids = Array.from(
      { length: 10 },
      (_v, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    app.server.on('GET /v1/me/tickets', (c) =>
      c.query.get('when') === 'past' ? page([]) : page(ids.map((id, i) => summary({ id, serial: i }))),
    );
    let live = 0;
    let peak = 0;
    app.server.on('GET /v1/me/tickets/:id', async (_c, p) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return ticket({ id: p.id as string });
    });
    await app.ready;
    await syncTickets({ api: app.core.api, queryClient: app.core.queryClient });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(app.server.callsTo('GET /v1/me/tickets/:id')).toHaveLength(10);
  });

  it('keeps what it had, and the old stamp, when the list cannot be read', async () => {
    const app = mount();
    app.server.on('GET /v1/me/tickets', () => problem(500, 'internal'));
    await app.ready;
    app.core.queryClient.setQueryData(ticketKeys.synced, 'earlier');
    app.core.queryClient.setQueryData(ticketKeys.detail(IDS.t1), ticket());
    expect(await syncTickets({ api: app.core.api, queryClient: app.core.queryClient })).toEqual({
      kind: 'failed',
    });
    expect(app.core.queryClient.getQueryData(ticketKeys.synced)).toBe('earlier');
    expect(app.core.queryClient.getQueryData(ticketKeys.detail(IDS.t1))).toBeDefined();
  });

  it('counts a record it could not fetch, keeps the older copy, and does not move the stamp', async () => {
    const app = mount();
    app.server.on('GET /v1/me/tickets', (c) =>
      c.query.get('when') === 'past' ? page([]) : page([summary({ rev: 5 })]),
    );
    app.server.on('GET /v1/me/tickets/:id', () => problem(500, 'internal'));
    await app.ready;
    app.core.queryClient.setQueryData(ticketKeys.synced, 'earlier');
    app.core.queryClient.setQueryData(ticketKeys.detail(IDS.t1), ticket({ rev: 1 }));
    const result = await syncTickets({ api: app.core.api, queryClient: app.core.queryClient });
    expect(result).toMatchObject({ kind: 'synced', failedDetails: 1 });
    expect(app.core.queryClient.getQueryData(ticketKeys.synced)).toBe('earlier');
    expect(app.core.queryClient.getQueryData<{ rev: number }>(ticketKeys.detail(IDS.t1))?.rev).toBe(1);
  });

  it('works with a bare QueryClient (no persistence needed)', async () => {
    const app = mount();
    app.server.on('GET /v1/me/tickets', () => page([]));
    await app.ready;
    const qc = new QueryClient();
    expect(await syncTickets({ api: app.core.api, queryClient: qc })).toMatchObject({ kind: 'synced' });
    qc.clear();
  });
});
