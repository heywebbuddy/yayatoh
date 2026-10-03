import {
  agencyClientsQuery,
  agencyEventsQuery,
  agencySnapshotSubscriber,
  refreshAgencySnapshotsCommand,
} from '@yayatoh/agency';
import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withoutTenant, withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, listEventsQuery } from '@yayatoh/events';
import {
  type Ctx,
  createCtx,
  type DomainError,
  executeCommand,
  executeQuery,
  isDomainError,
  uuidv7,
} from '@yayatoh/kernel';
import { auditLogQuery, catchUpSubscriber } from '@yayatoh/platform';
import {
  addMemberCommand,
  agencyAccess,
  consoleRole,
  getOrganizationQuery,
  grantAgencyAccessCommand,
  listAgencyGrantsQuery,
  listApiKeysQuery,
  listMembersQuery,
  MONEY_TABLES,
  myAgencyClients,
  revokeAgencyGrantCommand,
  updateAgencyGrantCommand,
  createOrganization,
} from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, staleCtx, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let agencyId: string;
let agencySlug: string;
const agencyOwner = uuidv7();
const staff = uuidv7();
/** A member of a second agency that holds no grant at all. */
const stranger = uuidv7();
let strangerAgencyId: string;
/** The grant org A gives the agency (each fixture org also grants its own fixture agency). */
let grantA: string;

/** The database's message for a failed statement (drizzle wraps it as the cause). */
const pgMessage = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (err) {
    return String((err as { cause?: unknown }).cause ?? err);
  }
  return '';
};

const errorOf = async (p: Promise<unknown>): Promise<DomainError> => {
  try {
    await p;
  } catch (err) {
    if (isDomainError(err)) return err;
    throw err;
  }
  throw new Error('expected a DomainError');
};

/** The agency staff member acting in `orgId` through `grantId`. */
const via = (orgId: string, grantId: string, agency = agencyId): Ctx =>
  userCtx(staff, orgId, { viaAgency: { grantId, agencyOrgId: agency } });
const agencyCtx = () => userCtx(staff, agencyId);

const countRows = (ctx: Ctx, table: string) =>
  withTenant(ctx, async (tx) => {
    const [r] = await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`));
    return r?.n ?? 0;
  });

const grant = (o: OrgFixture, role: 'manager' | 'marketing' | 'viewer' = 'manager', finance = false) =>
  executeCommand(grantAgencyAccessCommand, { agency: agencySlug, role, finance }, o.ctx(), ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const tag = uuidv7().slice(-8);
  agencySlug = `bloom-${tag}`;
  const agency = await createOrganization(
    userCtx(agencyOwner),
    { slug: agencySlug, name: 'Bloom Agency', kind: 'agency' },
    ports,
  );
  agencyId = agency.id;
  await executeCommand(addMemberCommand, { userId: staff, role: 'manager' }, userCtx(agencyOwner, agencyId), ports);
  await executeCommand(
    setEntitlementOverrideCommand,
    { moduleKey: 'agency', effect: 'grant', reason: 'agency fixture' },
    systemCtx(agencyId),
    ports,
  );
  const other = await createOrganization(
    userCtx(stranger),
    { slug: `thorn-${tag}`, name: 'Thorn Agency', kind: 'agency' },
    ports,
  );
  strangerAgencyId = other.id;
}, 240_000);
afterAll(closePools);

describe('agency v1: grants (M6.7a)', () => {
  it('an agency user without a grant sees nothing of a client org', async () => {
    expect(await myAgencyClients(staff)).toEqual([]);
    expect(await agencyAccess(userCtx(staff, a.org.id))).toBeNull();
    expect(await consoleRole(userCtx(staff, a.org.id))).toBeNull();
    // Even claiming a grant id, nothing is authorized.
    const fake = via(a.org.id, uuidv7());
    expect((await errorOf(executeQuery(getOrganizationQuery, {}, fake, ports))).code).toBe('forbidden');
    expect((await errorOf(executeQuery(listEventsQuery, {}, fake, ports))).code).toBe('forbidden');
    // The agency's own pages list no client.
    expect(await executeQuery(agencyClientsQuery, {}, agencyCtx(), ports)).toEqual([]);
  });

  it('validates the grant: unknown, non-agency and own addresses, step-up and role', async () => {
    const bad = (agency: string) =>
      errorOf(executeCommand(grantAgencyAccessCommand, { agency, role: 'viewer' }, a.ctx(), ports));
    expect((await bad(`nobody-${uuidv7().slice(-6)}`)).code).toBe('validation_failed');
    // An organizer (not an agency) cannot be granted.
    expect((await bad(b.org.slug)).code).toBe('validation_failed');
    // Step-up: a stale session is refused.
    expect(
      (
        await errorOf(
          executeCommand(grantAgencyAccessCommand, { agency: agencySlug, role: 'viewer' }, staleCtx(a.ctx()), ports),
        )
      ).code,
    ).toBe('step_up_required');
    // A viewer of the client may not grant access.
    expect(
      (
        await errorOf(
          executeCommand(
            grantAgencyAccessCommand,
            { agency: agencySlug, role: 'viewer' },
            userCtx(a.viewerId, a.org.id),
            ports,
          ),
        )
      ).code,
    ).toBe('forbidden');
    // An agency can't grant itself.
    const self = await errorOf(
      executeCommand(grantAgencyAccessCommand, { agency: agencySlug, role: 'viewer' }, userCtx(agencyOwner, agencyId), ports),
    );
    expect(self.code).toBe('validation_failed');
  });

  it('a grant to org A opens A (within its role) and never B', async () => {
    const g = await grant(a, 'manager');
    grantA = g.id;
    expect(g).toMatchObject({ agencyName: 'Bloom Agency', agencySlug, role: 'manager', finance: false });
    // A second live grant to the same agency is a conflict.
    expect((await errorOf(grant(a))).code).toBe('conflict');

    const clients = await myAgencyClients(staff);
    expect(clients.map((c) => c.orgId)).toEqual([a.org.id]);
    expect(clients[0]).toMatchObject({ agencyOrgId: agencyId, agencyName: 'Bloom Agency', role: 'manager' });
    // The stranger's agency holds no grant.
    expect(await myAgencyClients(stranger)).toEqual([]);

    const access = await agencyAccess(userCtx(staff, a.org.id));
    expect(access).toMatchObject({ grantId: g.id, agencyOrgId: agencyId, consoleRole: 'agency_manager' });
    expect(await agencyAccess(userCtx(staff, b.org.id))).toBeNull();
    expect(await agencyAccess(userCtx(stranger, a.org.id))).toBeNull();

    // Within the role: events yes; members, API keys and finance no.
    const ctx = via(a.org.id, g.id);
    expect((await executeQuery(listEventsQuery, {}, ctx, ports)).map((e) => e.id)).toContain(a.event.id);
    for (const q of [listMembersQuery, listApiKeysQuery, listAgencyGrantsQuery])
      expect((await errorOf(executeQuery(q, {}, ctx, ports))).code).toBe('forbidden');
    // The context must name the grant: without it, or naming another agency, nothing is allowed.
    expect((await errorOf(executeQuery(listEventsQuery, {}, userCtx(staff, a.org.id), ports))).code).toBe(
      'forbidden',
    );
    expect(
      (await errorOf(executeQuery(listEventsQuery, {}, via(a.org.id, g.id, strangerAgencyId), ports))).code,
    ).toBe('forbidden');
    // A's grant never opens B.
    expect((await errorOf(executeQuery(listEventsQuery, {}, via(b.org.id, g.id), ports))).code).toBe('forbidden');
    // A stranger can't ride the grant.
    const riding = userCtx(stranger, a.org.id, { viaAgency: { grantId: g.id, agencyOrgId: agencyId } });
    expect((await errorOf(executeQuery(listEventsQuery, {}, riding, ports))).code).toBe('forbidden');

    // The client sees the grant with the agency's name.
    const list = await executeQuery(listAgencyGrantsQuery, {}, a.ctx(), ports);
    expect(list.live.map((l) => l.id)).toContain(g.id);
  });

  it('audit rows record the agency and the grant next to the user', async () => {
    const g = { id: grantA };
    const event = await executeCommand(
      createEventCommand,
      {
        name: 'Agency Mixer',
        slug: `agency-mixer-${uuidv7().slice(-6)}`,
        timezone: 'America/Chicago',
        startsAt: '2027-11-01T18:00:00Z',
        endsAt: '2027-11-01T22:00:00Z',
      },
      via(a.org.id, g.id),
      ports,
    );
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ actor: string; data: Record<string, unknown> }>(
        sql`select actor, data from platform.audit_events where target_id = ${event.id} order by seq desc limit 1`,
      ),
    );
    expect(row?.actor).toBe(`user:${staff}`);
    expect(row?.data).toMatchObject({ viaAgency: `org:${agencyId}`, agencyGrantId: g.id });
    // The org's Activity view shows them.
    const log = await executeQuery(auditLogQuery, { limit: 100 }, a.ctx(), ports);
    const entry = log.entries.find((e) => e.targetId === event.id);
    expect(entry?.details).toMatchObject({ viaAgency: `org:${agencyId}`, agencyGrantId: g.id });
  });

  it('an agency user never reads a client money table without the finance opt-in', async () => {
    // Every payments table is on the list.
    const payments = await withoutTenant((tx) =>
      tx.execute<{ t: string }>(
        sql`select schemaname || '.' || tablename as t from pg_tables where schemaname = 'payments'`,
      ),
    );
    for (const { t } of payments) expect(MONEY_TABLES as readonly string[]).toContain(t);
    // Every money table carries the restrictive row guard.
    const guarded = await withoutTenant((tx) =>
      tx.execute<{ t: string }>(
        sql`select schemaname || '.' || tablename as t from pg_policies where permissive = 'RESTRICTIVE' and policyname like '%_agency_money_guard'`,
      ),
    );
    expect(new Set(guarded.map((r) => r.t))).toEqual(new Set(MONEY_TABLES));

    const g = { id: grantA };
    const owner = a.ctx();
    const agent = via(a.org.id, g.id);
    for (const table of MONEY_TABLES) {
      expect(await countRows(owner, table), `${table}: fixture rows`).toBeGreaterThan(0);
      expect(await countRows(agent, table), `${table}: agency without finance`).toBe(0);
    }
    // Inserting is refused too.
    expect(
      await pgMessage(
        withTenant(agent, (tx) =>
          tx.execute(
            sql`insert into payments.reconciliation_runs (org_id, day, provider, ledger_count, provider_count, item_count) values (${a.org.id}, '2020-01-01', 'fake', 0, 0, 0)`,
          ),
        ),
      ),
    ).toMatch(/row-level security/);

    // The client opts in: the agency reads exactly what the owner reads (and still writes nothing it can't).
    await executeCommand(updateAgencyGrantCommand, { grantId: g.id, role: 'manager', finance: true }, a.ctx(), ports);
    expect((await agencyAccess(userCtx(staff, a.org.id)))?.consoleRole).toBe('agency_manager_finance');
    for (const table of MONEY_TABLES)
      expect(await countRows(agent, table), `${table}: with finance`).toBe(await countRows(owner, table));
    // A's finance opt-in never opens B's money, even naming A's grant.
    for (const table of MONEY_TABLES) expect(await countRows(via(b.org.id, g.id), table)).toBe(0);

    // Withdrawn again: back to nothing on the next request.
    await executeCommand(updateAgencyGrantCommand, { grantId: g.id, role: 'manager', finance: false }, a.ctx(), ports);
    for (const table of MONEY_TABLES) expect(await countRows(agent, table)).toBe(0);
  });

  it('the agency pages read snapshots of live clients only; money only with the opt-in', async () => {
    const r = await executeCommand(refreshAgencySnapshotsCommand, {}, agencyCtx(), ports);
    expect(r.clients).toBe(1);
    const clients = await executeQuery(agencyClientsQuery, {}, agencyCtx(), ports);
    expect(clients.map((c) => c.clientOrgId)).toEqual([a.org.id]);
    const snap = clients[0]?.snapshot;
    expect(snap).toBeTruthy();
    expect(snap?.eventsTotal).toBeGreaterThan(0);
    expect(snap?.revenue).toBeNull();
    const events = await executeQuery(agencyEventsQuery, {}, agencyCtx(), ports);
    expect(events.map((e) => e.eventId)).toContain(a.event.id);
    expect(events.every((e) => e.clientOrgId === a.org.id && e.grossMinor === null)).toBe(true);

    // The stranger agency and B's owner can't read the agency's pages.
    expect(
      (await errorOf(executeQuery(agencyClientsQuery, {}, userCtx(stranger, agencyId), ports))).code,
    ).toBe('forbidden');
    // Another agency without the `agency` entitlement can't refresh.
    expect(
      (await errorOf(executeCommand(refreshAgencySnapshotsCommand, {}, userCtx(stranger, strangerAgencyId), ports)))
        .code,
    ).toBe('module_not_enabled');

    // With finance, revenue appears per currency.
    const g = { id: grantA };
    await executeCommand(updateAgencyGrantCommand, { grantId: g.id, role: 'manager', finance: true }, a.ctx(), ports);
    await executeCommand(refreshAgencySnapshotsCommand, {}, agencyCtx(), ports);
    const withMoney = await executeQuery(agencyClientsQuery, {}, agencyCtx(), ports);
    expect(withMoney[0]?.snapshot?.revenue).not.toBeNull();
    // Opt-in withdrawn: hidden at once, before any refresh.
    await executeCommand(updateAgencyGrantCommand, { grantId: g.id, role: 'manager', finance: false }, a.ctx(), ports);
    expect((await executeQuery(agencyClientsQuery, {}, agencyCtx(), ports))[0]?.snapshot?.revenue).toBeNull();
    expect((await executeQuery(agencyEventsQuery, {}, agencyCtx(), ports)).every((e) => e.grossMinor === null)).toBe(
      true,
    );
  });

  it('a revoked grant cuts access on the next request', async () => {
    const g = { id: grantA };
    const held = via(a.org.id, g.id);
    await executeQuery(listEventsQuery, {}, held, ports);
    // Revoking needs no step-up (taking access away is always one click).
    await executeCommand(revokeAgencyGrantCommand, { grantId: g.id }, staleCtx(a.ctx()), ports);
    // The very same context (as a cached session would hold) is refused now.
    expect((await errorOf(executeQuery(listEventsQuery, {}, held, ports))).code).toBe('forbidden');
    expect(await agencyAccess(userCtx(staff, a.org.id))).toBeNull();
    expect(await myAgencyClients(staff)).toEqual([]);
    for (const table of MONEY_TABLES) expect(await countRows(held, table)).toBe(0);
    // The agency's pages drop the client at once, and the next refresh deletes its rows.
    expect(await executeQuery(agencyClientsQuery, {}, agencyCtx(), ports)).toEqual([]);
    expect(await executeQuery(agencyEventsQuery, {}, agencyCtx(), ports)).toEqual([]);
    await executeCommand(refreshAgencySnapshotsCommand, {}, agencyCtx(), ports);
    expect(await countRows(systemCtx(agencyId), 'agency.client_snapshots')).toBe(0);
    expect(await countRows(systemCtx(agencyId), 'agency.event_snapshots')).toBe(0);
    // History stays with the client.
    const list = await executeQuery(listAgencyGrantsQuery, {}, a.ctx(), ports);
    expect(list.live.map((r) => r.id)).not.toContain(g.id);
    expect(list.revoked.map((r) => r.id)).toContain(g.id);
    // The audit log has the grant's whole life.
    const log = await executeQuery(auditLogQuery, { limit: 100 }, a.ctx(), ports);
    const actions = log.entries.filter((e) => e.targetId === g.id).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['agencyGrant.create', 'agencyGrant.update', 'agencyGrant.revoke']));
  });

  it('the outbox subscriber snapshots a new client for its agency, and drops a revoked one', async () => {
    const g = await grant(b, 'viewer');
    await catchUpSubscriber(agencySnapshotSubscriber, b.org.id);
    const [snap] = await withTenant(systemCtx(agencyId), (tx) =>
      tx.execute<{ client_org_id: string }>(sql`select client_org_id from agency.client_snapshots`),
    );
    expect(snap?.client_org_id).toBe(b.org.id);
    const clients = await executeQuery(agencyClientsQuery, {}, agencyCtx(), ports);
    expect(clients.map((c) => [c.clientOrgId, c.role])).toEqual([[b.org.id, 'viewer']]);
    // A viewer grant reads events but writes nothing.
    const ctx = via(b.org.id, g.id);
    await executeQuery(listEventsQuery, {}, ctx, ports);
    expect(
      (
        await errorOf(
          executeCommand(
            createEventCommand,
            {
              name: 'Nope',
              slug: `nope-${uuidv7().slice(-6)}`,
              timezone: 'UTC',
              startsAt: '2027-11-01T18:00:00Z',
              endsAt: '2027-11-01T22:00:00Z',
            },
            ctx,
            ports,
          ),
        )
      ).code,
    ).toBe('forbidden');
    await executeCommand(revokeAgencyGrantCommand, { grantId: g.id }, b.ctx(), ports);
    await catchUpSubscriber(agencySnapshotSubscriber, b.org.id);
    expect(await countRows(systemCtx(agencyId), 'agency.client_snapshots')).toBe(0);
  });

  it('a suspended agency loses its grants’ access', async () => {
    const g = await grant(a, 'viewer');
    expect(await agencyAccess(userCtx(staff, a.org.id))).not.toBeNull();
    await withTenant(systemCtx(agencyId), (tx) =>
      tx.execute(sql`update tenancy.organizations set status = 'suspended' where id = ${agencyId}`),
    );
    try {
      expect(await agencyAccess(userCtx(staff, a.org.id))).toBeNull();
      expect(await myAgencyClients(staff)).toEqual([]);
    } finally {
      await withTenant(systemCtx(agencyId), (tx) =>
        tx.execute(sql`update tenancy.organizations set status = 'active' where id = ${agencyId}`),
      );
      await executeCommand(revokeAgencyGrantCommand, { grantId: g.id }, a.ctx(), ports);
    }
    expect(createCtx({}).viaAgency).toBeNull();
  });
});
