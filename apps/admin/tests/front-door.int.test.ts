import { withoutTenant } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { uuidv7 } from '@yayatoh/kernel';
import { frontDoorFlags, recordFrontDoor } from '@yayatoh/platform';
import { flagKey, ROUTE_TABLE_VERSION } from '@yayatoh/platform/front-door';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { frontDoorOverview, routeAllowed, setFrontDoorFlag } from '../src/server/front-door-store.ts';

beforeAll(() => setPlatformAuditSink(databaseAuditSink));
afterAll(closePools);

/** Hosts unique to this run, so reruns and other files never see each other's flags. */
const tag = uuidv7().slice(-8);
const YAY = `yay-${tag}.frontdoor.test`;
const ABC = `abc-${tag}.frontdoor.test`;
const env = {
  LEGACY_ORIGIN_URL: 'http://127.0.0.1:3390',
  LEGACY_ABC_ORIGIN_URL: 'http://127.0.0.1:3391',
  LEGACY_YAY_HOSTS: YAY,
  LEGACY_ABC_HOSTS: ABC,
};
const ACTOR = `staff:${uuidv7()}`;

async function rejectsWith(p: Promise<unknown>, re: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(err).not.toBeNull();
  expect(`${err?.message} ${err?.cause?.message ?? ''}`).toMatch(re);
}

describe('front door flags (M2.4a)', () => {
  it('a flag change needs a recent step-up and a staff actor, and is audited with it', async () => {
    const input = { host: YAY, route: 'events.listing', state: 'next' as const, reason: 'A2 soak start' };
    await rejectsWith(
      setFrontDoorFlag(ACTOR, input, new Date(Date.now() - 11 * 60_000)),
      /recent step-up is required/,
    );
    await rejectsWith(setFrontDoorFlag('system:cli', input, new Date()), /staff actor is required/);
    await rejectsWith(setFrontDoorFlag(ACTOR, { ...input, reason: 'x' }, new Date()), /reason_check/);
    expect((await frontDoorFlags()).get(flagKey(YAY, 'events.listing'))).toBeUndefined();

    const stepUp = new Date(Date.now() - 60_000);
    expect(await setFrontDoorFlag(ACTOR, input, stepUp)).toBe('legacy');
    expect(
      await setFrontDoorFlag(ACTOR, { ...input, state: 'canary', reason: 'back to canary' }, stepUp),
    ).toBe('next');
    expect((await frontDoorFlags()).get(flagKey(YAY, 'events.listing'))).toBe('canary');

    const changes = await withPlatformReader({ actor: 'test', reason: 'read front door audit' }, (tx) =>
      tx.execute<{
        from_state: string;
        to_state: string;
        actor: string;
        reason: string;
        stepped_up_at: string;
        table_version: number;
      }>(
        sql`select from_state, to_state, actor, reason, stepped_up_at, table_version
            from platform.front_door_flag_changes where host = ${YAY} order by at, id`,
      ),
    );
    expect(changes.map((c) => [c.from_state, c.to_state, c.reason])).toEqual([
      ['legacy', 'next', 'A2 soak start'],
      ['next', 'canary', 'back to canary'],
    ]);
    expect(changes.every((c) => c.actor === ACTOR && c.table_version === ROUTE_TABLE_VERSION)).toBe(true);
    expect(new Date(changes[0]?.stepped_up_at ?? 0).getTime()).toBe(stepUp.getTime());

    // The platform access log names the staff member and the change, for every attempt (the
    // two refused ones above included: the log is written before the function runs).
    const [log] = await withPlatformReader({ actor: 'test', reason: 'read access log' }, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.access_log
            where actor = ${ACTOR} and reason like ${`%front door ${YAY} events.listing%`}`,
      ),
    );
    expect(log?.n).toBe(4);
  });

  it('flags are per host: one host moving a route leaves the other alone', async () => {
    await setFrontDoorFlag(
      ACTOR,
      { host: ABC, route: 'home', state: 'next', reason: 'abc home' },
      new Date(),
    );
    const flags = await frontDoorFlags();
    expect(flags.get(flagKey(ABC, 'home'))).toBe('next');
    expect(flags.get(flagKey(YAY, 'home'))).toBeUndefined();
  });

  it('only routes of the host’s instance can be moved', () => {
    expect(routeAllowed(YAY, 'events.search', env)).toBe(true);
    expect(routeAllowed(ABC, 'events.search', env)).toBe(false);
    expect(routeAllowed(ABC, 'events.page', env)).toBe(true);
    expect(routeAllowed('other.example', 'home', env)).toBe(false);
    expect(routeAllowed(YAY, 'no.such.route', env)).toBe(false);
  });

  it('the runtime role cannot read or change flags, audit or counters directly', async () => {
    for (const table of [
      'front_door_flags',
      'front_door_flag_changes',
      'front_door_stats',
      'front_door_not_found',
    ])
      await rejectsWith(
        withoutTenant((tx) => tx.execute(sql.raw(`select * from platform.${table} limit 1`))),
        /permission denied/,
      );
    await rejectsWith(
      withoutTenant((tx) =>
        tx.execute(
          sql`insert into platform.front_door_flags (host, route, state, table_version, updated_by)
              values (${YAY}, 'home', 'next', 1, 'x')`,
        ),
      ),
      /permission denied/,
    );
    await rejectsWith(
      withoutTenant((tx) =>
        tx.execute(
          sql`select platform.set_front_door_flag(${YAY}, 'home', 'next', 1, ${ACTOR}, 'sneaky', now())`,
        ),
      ),
      /permission denied/,
    );
  });

  it('platform_reader reads but never writes the tables directly', async () => {
    await rejectsWith(
      withPlatformReader(
        { actor: 'test', reason: 'try a direct write' },
        (tx) => tx.execute(sql`update platform.front_door_flags set state = 'next' where host = ${ABC}`),
        { callsWritingFunctions: true },
      ),
      /permission denied/,
    );
  });
});

describe('front door counters (M2.4a watch)', () => {
  it('adds batches per day × host × route, keeps the 404 top list, and the console reads them', async () => {
    const stat = (over: Partial<Parameters<typeof recordFrontDoor>[0][number]> = {}) => ({
      host: YAY,
      route: 'legacy',
      servedBy: 'legacy' as const,
      requests: 1,
      notFound: 0,
      proxyErrors: 0,
      upstream5xx: 0,
      latencyCount: 1,
      latencyMsSum: 40,
      latencyMsMax: 40,
      ...over,
    });
    await recordFrontDoor(
      [stat(), stat({ requests: 3, notFound: 2, latencyCount: 3, latencyMsSum: 90, latencyMsMax: 60 })],
      [{ host: YAY, path: '/gone', servedBy: 'legacy', count: 2 }],
    );
    await recordFrontDoor(
      [
        stat({ proxyErrors: 1, latencyMsSum: 3000, latencyMsMax: 3000 }),
        stat({
          route: 'events.listing',
          servedBy: 'next',
          latencyCount: 0,
          latencyMsSum: 0,
          latencyMsMax: 0,
        }),
        stat({ host: 'x'.repeat(300), route: 'r', servedBy: 'bogus' as never }),
      ],
      [
        { host: YAY, path: '/gone', servedBy: 'legacy', count: 1 },
        { host: YAY, path: `/${'p'.repeat(400)}`, servedBy: 'next', count: 1 },
      ],
    );
    const o = await frontDoorOverview('test', 7, env);
    const legacy = o.other.find((r) => r.host === YAY && r.route === 'legacy');
    expect(legacy).toEqual({
      host: YAY,
      route: 'legacy',
      servedBy: 'legacy',
      requests: 5,
      notFound: 2,
      proxyErrors: 1,
      upstream5xx: 0,
      avgLatencyMs: Math.round((40 + 90 + 3000) / 5),
      maxLatencyMs: 3000,
    });
    const listing = o.routes.find((r) => r.host === YAY && r.route === 'events.listing');
    expect(listing).toMatchObject({ state: 'canary', requests: 1, avgLatencyMs: null, updatedBy: ACTOR });
    expect(o.routes.filter((r) => r.host === ABC).map((r) => r.route)).not.toContain('events.search');
    expect(o.notFound.find((r) => r.host === YAY && r.path === '/gone')).toEqual({
      host: YAY,
      path: '/gone',
      servedBy: 'legacy',
      count: 3,
    });
    expect(o.notFound.find((r) => r.host === YAY && r.servedBy === 'next')?.path).toHaveLength(300);
    expect(o.changes.some((c) => c.host === YAY && c.toState === 'canary')).toBe(true);
    // The invalid row (served_by) was ignored, not stored.
    const [bad] = await withPlatformReader({ actor: 'test', reason: 'check ignored row' }, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.front_door_stats where route = 'r'`,
      ),
    );
    expect(bad?.n).toBe(0);
  });
});
