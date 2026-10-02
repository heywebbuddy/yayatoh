import * as ai from '@yayatoh/ai';
import * as alerts from '@yayatoh/alerts';
import * as attendees from '@yayatoh/attendees';
import * as audiences from '@yayatoh/audiences';
import * as billing from '@yayatoh/billing';
import * as checkin from '@yayatoh/checkin';
import * as cms from '@yayatoh/cms';
import * as commandCenter from '@yayatoh/command-center';
import * as crm from '@yayatoh/crm';
import { withoutTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import * as events from '@yayatoh/events';
import * as forms from '@yayatoh/forms';
import * as guests from '@yayatoh/guests';
import {
  type Command,
  type Ctx,
  createCtx,
  DomainError,
  executeCommand,
  executeQuery,
  isDomainError,
} from '@yayatoh/kernel';
import * as marketing from '@yayatoh/marketing';
import * as marketplace from '@yayatoh/marketplace';
import * as media from '@yayatoh/media';
import * as messaging from '@yayatoh/messaging';
import * as notifications from '@yayatoh/notifications';
import * as orders from '@yayatoh/orders';
import * as payments from '@yayatoh/payments';
import * as platform from '@yayatoh/platform';
import { freezeCovers, hostRoute, readOnlyFreeze } from '@yayatoh/platform';
import { problemFor, problemResponse } from '@yayatoh/platform/http';
import * as privacy from '@yayatoh/privacy';
import * as program from '@yayatoh/program';
import * as registration from '@yayatoh/registration';
import * as reports from '@yayatoh/reports';
import * as reviews from '@yayatoh/reviews';
import * as seating from '@yayatoh/seating';
import * as surveys from '@yayatoh/surveys';
import * as templates from '@yayatoh/templates';
import * as tenancy from '@yayatoh/tenancy';
import * as ticketing from '@yayatoh/ticketing';
import * as venues from '@yayatoh/venues';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * M2.5a read-only freeze: every write command is refused (whatever its category or input) while
 * the platform or the org is frozen; reads, check-in scans and refund completion keep working; an
 * org-scoped freeze never touches another org; only platform_reader/migrator can switch it.
 */
const MODULES = {
  ai,
  // Batch 3d merge: M3.2b's alert engine and M3.2a's Command Center (M3.4a and M3.5b grew
  // checkin and notifications, already listed).
  alerts,
  attendees,
  // Batch 3c merge: the modules of batch 3b (audiences, marketing) and 3c (guests; cms grew).
  audiences,
  billing,
  checkin,
  cms,
  commandCenter,
  crm,
  events,
  forms,
  guests,
  marketing,
  marketplace,
  media,
  messaging,
  notifications,
  orders,
  payments,
  platform,
  privacy,
  program,
  // M5.1c: registration's commands (apply, decide, groups, +1, substitution) are swept too.
  registration,
  reports,
  reviews,
  seating,
  surveys,
  templates,
  tenancy,
  ticketing,
  venues,
};

type AnyCommand = Command<unknown, unknown, unknown, unknown>;
const isCommand = (v: unknown): v is AnyCommand =>
  typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'command';

/** Every command the modules export (one entry per command name). */
const COMMANDS: AnyCommand[] = [
  ...new Map(
    Object.values(MODULES)
      .flatMap((m) => Object.values(m as Record<string, unknown>))
      .filter(isCommand)
      .map((c) => [c.name, c] as const),
  ).values(),
];
const ALLOWED = new Set(COMMANDS.filter((c) => c.duringFreeze === 'allowed').map((c) => c.name));

let a: OrgFixture;
let b: OrgFixture;
let free: { eventId: string; ticketTypeId: string };
const admin = adminClient();
const setFreeze = (value: unknown) =>
  admin`select platform.set_ops_flag('read_only_freeze', ${value === null ? null : JSON.stringify(value)}::text::jsonb, 'test', 'test:freeze')`;

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return isDomainError(err) ? err.code : `thrown:${String(err)}`;
  }
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    events.createEventCommand,
    {
      name: `Freeze door ${Date.now()}`,
      timezone: 'UTC',
      startsAt: '2031-02-01T18:00:00Z',
      endsAt: '2031-02-01T23:00:00Z',
    },
    a.ctx(),
    ports,
  );
  const t = await executeCommand(
    ticketing.createTicketTypeCommand,
    { eventId: e.id, name: 'Free', priceMinor: 0, quantityTotal: 10 },
    a.ctx(),
    ports,
  );
  await executeCommand(
    events.transitionEventCommand,
    { eventId: e.id, transition: 'publish' },
    a.ctx(),
    ports,
  );
  free = { eventId: e.id, ticketTypeId: t.id };
});
afterEach(async () => {
  await setFreeze(null);
});
afterAll(async () => {
  await setFreeze(null);
  await admin.end();
  await closePools();
});

describe('read-only freeze (M2.5a)', () => {
  it('the sweep covers every category and allows only scans and provider-completion writes', () => {
    expect(COMMANDS.length).toBeGreaterThan(150);
    const categories = new Set(
      COMMANDS.filter((c) => !ALLOWED.has(c.name)).map((c) => c.category ?? 'write'),
    );
    // `export` is a query category (downloads are reads and keep working); every command category
    // (money, delete and plain writes, which include starting an export job) is swept below.
    expect([...categories].sort()).toEqual(['delete', 'money', 'write']);
    expect([...ALLOWED].sort()).toEqual([
      'checkin.heartbeat',
      'checkin.scanTicket',
      'checkin.syncScans',
      'checkin.undoAdmission',
      'orders.completeRefund',
      'payments.recordTransferReversal',
    ]);
  });

  it('refuses every other exported command, for members, staff and system actors alike', async () => {
    await setFreeze({ scope: 'orgs', orgIds: [a.org.id] });
    const actors: Ctx[] = [a.ctx(), systemCtx(a.org.id), createCtx({ orgId: a.org.id })];
    const wrong: string[] = [];
    for (const c of COMMANDS) {
      if (ALLOWED.has(c.name)) continue;
      for (const ctx of actors) {
        const code = await codeOf(executeCommand(c, {}, ctx, ports));
        if (code !== 'read_only_freeze') wrong.push(`${c.name} (${ctx.actor.type}): ${code}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('a platform-wide freeze also refuses platform-level (org-less) commands', async () => {
    await setFreeze({ scope: 'platform' });
    // Org-less contexts (platform-level work, signup) are refused too; an org-scoped freeze would not.
    for (const c of COMMANDS.filter((x) => !ALLOWED.has(x.name)).slice(0, 25))
      expect(await codeOf(executeCommand(c, {}, createCtx({ orgId: null }), ports))).toBe('read_only_freeze');
    await setFreeze({ scope: 'orgs', orgIds: [a.org.id] });
    expect(
      await codeOf(executeCommand(tenancy.createOrganizationCommand, {}, createCtx({ orgId: null }), ports)),
    ).toBe('validation_failed');
    await setFreeze({ scope: 'platform' });
    expect(await codeOf(executeCommand(events.createEventCommand, { name: 'Nope' }, b.ctx(), ports))).toBe(
      'read_only_freeze',
    );
  });

  it('isolation: freezing one org leaves the other org writing normally', async () => {
    await setFreeze({ scope: 'orgs', orgIds: [a.org.id] });
    const e = await executeCommand(
      events.createEventCommand,
      {
        name: `Still writing ${Date.now()}`,
        timezone: 'UTC',
        startsAt: '2031-01-01T10:00:00Z',
        endsAt: '2031-01-01T12:00:00Z',
      },
      b.ctx(),
      ports,
    );
    expect(e.id).toBeTruthy();
    expect(
      await codeOf(
        executeCommand(
          events.createEventCommand,
          {
            name: 'Frozen',
            timezone: 'UTC',
            startsAt: '2031-01-01T10:00:00Z',
            endsAt: '2031-01-01T12:00:00Z',
          },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('read_only_freeze');
    const state = await readOnlyFreeze();
    expect(freezeCovers(state, a.org.id)).toBe(true);
    expect(freezeCovers(state, b.org.id)).toBe(false);
    expect(freezeCovers(state, null)).toBe(false);
  });

  it('reads keep working while frozen', async () => {
    await setFreeze({ scope: 'platform' });
    const list = await executeQuery(ticketing.listTicketTypesQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(Array.isArray(list)).toBe(true);
    const org = await executeQuery(tenancy.getOrganizationQuery, {}, a.ctx(), ports);
    expect(org.id).toBe(a.org.id);
  });

  it('check-in scans keep working while frozen (the door stays open)', async () => {
    const r = await executeCommand(
      orders.startCheckoutCommand,
      {
        eventId: free.eventId,
        items: [{ ticketTypeId: free.ticketTypeId, quantity: 1 }],
        buyer: { email: 'frozen-door@example.test', name: 'Door Guest' },
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    const order = await orders.orderByManageToken(r.manageToken);
    const ticket = order?.tickets[0];
    if (!ticket) throw new Error('checkout did not issue a ticket');
    await setFreeze({ scope: 'platform' });
    const scan = await executeCommand(
      checkin.scanTicketCommand,
      { eventId: free.eventId, code: ticket.code },
      a.ctx({ now: new Date('2031-02-01T19:00:00Z') }),
      ports,
    );
    expect(scan.result).toBe('admitted');
  });

  it('the refusal carries the end and a Retry-After; problem+json says 503', async () => {
    const end = new Date(Date.now() + 20 * 60_000).toISOString();
    await setFreeze({ scope: 'platform', expectedEndAt: end });
    let err: unknown;
    try {
      await executeCommand(events.createEventCommand, {}, a.ctx(), ports);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DomainError);
    const p = problemFor(err);
    expect(p).toMatchObject({ status: 503, code: 'read_only_freeze', details: { expectedEndAt: end } });
    const retry = Number(p.details?.retryAfterSeconds);
    expect(retry).toBeGreaterThan(18 * 60);
    expect(retry).toBeLessThanOrEqual(20 * 60);
    expect(problemResponse(p).headers.get('retry-after')).toBe(String(retry));
  });

  it('only platform_reader or migrator switch it; app_user reads through the function only', async () => {
    const denied = async (p: Promise<unknown>) => {
      const err = await p.then(
        () => null,
        (e: unknown) => e as { cause?: { message?: string }; message?: string },
      );
      expect(`${err?.message} ${err?.cause?.message}`).toMatch(/permission denied/);
    };
    await denied(
      withoutTenant((tx) =>
        tx.execute(
          sql`select platform.set_ops_flag('read_only_freeze', '{"scope":"platform"}'::jsonb, 'x', 'app')`,
        ),
      ),
    );
    await denied(withoutTenant((tx) => tx.execute(sql`select * from platform.ops_flags`)));
    expect(await readOnlyFreeze()).toBeNull();
    // Shapes are checked by the function too.
    await expect(setFreeze({ scope: 'orgs', orgIds: [] })).rejects.toThrow(/invalid read_only_freeze/);
    await expect(setFreeze({ scope: 'everything' })).rejects.toThrow(/invalid read_only_freeze/);
  });

  it('every change is kept in the history; the host route is readable by the app', async () => {
    await setFreeze({ scope: 'orgs', orgIds: [b.org.id] });
    await setFreeze(null);
    const rows = await admin<{ value: unknown; actor: string }[]>`
      select value, actor from platform.ops_flag_changes where key = 'read_only_freeze' order by at desc, id desc limit 2`;
    expect(rows.map((r) => r.value)).toEqual([null, { scope: 'orgs', orgIds: [b.org.id] }]);
    expect(rows.every((r) => r.actor === 'test:freeze')).toBe(true);

    const host = `freeze-${Date.now()}.example.test`;
    expect(await hostRoute(host)).toBeNull();
    await admin`select platform.set_ops_flag(${`host_route:${host}`}, '{"target":"legacy"}'::jsonb, 'test', 'test:freeze')`;
    expect(await hostRoute(host.toUpperCase())).toBe('legacy');
    await expect(
      admin`select platform.set_ops_flag(${`host_route:${host}`}, '{"target":"elsewhere"}'::jsonb, 'test', 'test:freeze')`,
    ).rejects.toThrow(/invalid host_route/);
    await admin`select platform.set_ops_flag(${`host_route:${host}`}, null, 'test', 'test:freeze')`;
    expect(await hostRoute(host)).toBeNull();
  });
});
