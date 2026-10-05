import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { contactIdByEmailTx, upsertContactTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import {
  beginConnectCommand,
  CONNECTION_REVOKED_EVENT,
  claimRunCommand,
  completeConnectCommand,
  connectionDetailQuery,
  DEMO_BAD_RECORD,
  DEMO_SEED,
  demoRemoteRecords,
  demoRemoteUpdate,
  disconnectCommand,
  dismissErrorsCommand,
  FAKE_ACCESS_TOKEN,
  FAKE_REFRESH_TOKEN,
  failConnectCommand,
  fakeIntegrations,
  listConnectionsQuery,
  listErrorGroupsQuery,
  mappingVersionsQuery,
  originStamp,
  pendingConnectionQuery,
  requestSyncCommand,
  resetCursorsTx,
  retryErrorsCommand,
  runDueSyncs,
  runSync,
  SYNC_ACTOR,
  SYNC_COMPLETED_EVENT,
  saveMappingCommand,
  setConnectionPausedCommand,
  setSyncIntervalCommand,
} from '@yayatoh/integrations';
import { type Ctx, createCtx, DomainError, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { findCanaries } from '../src/canary/index.ts';
import {
  bareOrg,
  connectDemo,
  fakeAuth,
  type OrgFixture,
  ports,
  systemCtx,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

/**
 * M6.4a integrations framework on real Postgres with the fake `IntegrationAuth`: connect,
 * mappings, the sync engine (replays write once, loop guards, concurrency of one, retries),
 * revocation within one run, the errors inbox, permissions, isolation, and the token canaries.
 */

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;
const deps = { auth: fakeAuth };
const tag = uuidv7().slice(-8);
let n = 0;
const fresh = () => bareOrg(`integ-${tag}-${++n}`, `Integrations ${n}`);

// Everything the run logs is collected and checked for the token canaries at the end.
const logged: string[] = [];
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  // biome-ignore lint/suspicious/noConsole: the test captures every log line to check for token canaries
  const orig = console[level].bind(console);
  vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
    logged.push(
      args.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : JSON.stringify(x))).join(' '),
    );
    orig(...(args as []));
  });
}
const thrown: unknown[] = [];
const outputs: unknown[] = [];
const keep = <T>(v: T) => {
  outputs.push(v);
  return v;
};

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
}, 240_000);
afterAll(async () => {
  await closePools();
  await admin.end();
});

const sys = (orgId: string, now = new Date()) => createCtx({ orgId, actor: SYNC_ACTOR, now });
const contactCount = async (ctx: Ctx) => {
  const [r] = await withTenant(ctx, (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from crm.contacts`),
  );
  return r?.n ?? 0;
};
const contactRow = (ctx: Ctx, email: string) =>
  withTenant(ctx, async (tx) => {
    const [r] = await tx.execute<{ name: string | null; updated_at: Date }>(
      sql`select name, updated_at from crm.contacts where email_norm = ${email}`,
    );
    return r ?? null;
  });
const groups = async (ctx: Ctx, status: 'open' | 'resolved' | 'dismissed' = 'open') =>
  keep(await executeQuery(listErrorGroupsQuery, { status }, ctx, ports));
const account = (authConnectionId: string) => {
  const acc = fakeIntegrations.account(authConnectionId);
  if (!acc) throw new Error('no fake account');
  return acc;
};
const expectError = async (p: Promise<unknown>, code: string, reason?: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  thrown.push(err);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  if (reason) expect((err as DomainError).details?.reason).toBe(reason);
};

describe('connect (fake OAuth through the IntegrationAuth port)', () => {
  it('begin → consent → complete: active, default mappings v1, a first sync queued', async () => {
    const o = await fresh();
    const begun = await executeCommand(beginConnectCommand, { connector: 'demo' }, o.ctx(), ports);
    // Restarting a pending connect keeps the connection and replaces the state.
    const again = await executeCommand(beginConnectCommand, { connector: 'demo' }, o.ctx(), ports);
    expect(again.connectionId).toBe(begun.connectionId);
    expect(again.state).not.toBe(begun.state);
    await expectError(
      executeQuery(pendingConnectionQuery, { state: begun.state }, o.ctx(), ports),
      'not_found',
    );
    expect(await executeQuery(pendingConnectionQuery, { state: again.state }, o.ctx(), ports)).toEqual({
      connectionId: begun.connectionId,
      connector: 'demo',
    });
    // The callback with the old state is refused.
    await expectError(
      executeCommand(
        completeConnectCommand,
        {
          connectionId: begun.connectionId,
          state: begun.state,
          authConnectionId: 'fake_x',
          accountLabel: null,
        },
        o.ctx(),
        ports,
      ),
      'not_found',
    );
    const { url } = await fakeAuth.beginConnect({
      orgId: o.orgId,
      connectionId: begun.connectionId,
      providerConfigKey: 'demo',
      scopes: [],
      state: again.state,
      callbackUrl: '/cb',
    });
    expect(url).toContain(`connection=${begun.connectionId}`);
    fakeIntegrations.approve(
      { orgId: o.orgId, connectionId: begun.connectionId, providerConfigKey: 'demo' },
      (await import('@yayatoh/integrations')).demoFakeProvider,
    );
    const resolved = await fakeAuth.resolve({
      orgId: o.orgId,
      connectionId: begun.connectionId,
      providerConfigKey: 'demo',
    });
    if (!resolved) throw new Error('resolved');
    await executeCommand(
      completeConnectCommand,
      {
        connectionId: begun.connectionId,
        state: again.state,
        authConnectionId: resolved.authConnectionId,
        accountLabel: resolved.accountLabel,
      },
      o.ctx(),
      ports,
    );
    const detail = keep(
      await executeQuery(connectionDetailQuery, { connectionId: begun.connectionId }, o.ctx(), ports),
    );
    expect(detail.connection).toMatchObject({
      status: 'active',
      accountLabel: 'Demo CRM (sandbox)',
      connector: 'demo',
    });
    expect(detail.mappings.map((m) => `${m.objectType}:${m.direction}:v${m.version}`).sort()).toEqual([
      'contacts:pull:v1',
      'contacts:push:v1',
    ]);
    expect(detail.runs).toMatchObject([{ status: 'queued', trigger: 'schedule' }]);
    expect(detail.syncing).toBe(true);
    // One live connection per connector.
    await expectError(
      executeCommand(beginConnectCommand, { connector: 'demo' }, o.ctx(), ports),
      'conflict',
      'already_connected',
    );
    await expectError(
      executeCommand(beginConnectCommand, { connector: 'nope' }, o.ctx(), ports),
      'not_found',
    );
    // The connection never stores a token (only the provider-side id).
    const [row] = await admin.unsafe(`select * from integrations.connections where id = $1`, [
      begun.connectionId,
    ]);
    expect(JSON.stringify(row)).not.toContain(FAKE_ACCESS_TOKEN);
    expect(row?.auth_connection_id).toBe(resolved.authConnectionId);
    expect(row?.state_hash).toBeNull();
  });

  it('a refused consent ends the pending connection as failed; a new connect can start', async () => {
    const o = await fresh();
    const begun = await executeCommand(beginConnectCommand, { connector: 'demo' }, o.ctx(), ports);
    await executeCommand(
      failConnectCommand,
      { connectionId: begun.connectionId, reason: 'denied' },
      o.ctx(),
      ports,
    );
    const [listed] = await executeQuery(listConnectionsQuery, {}, o.ctx(), ports);
    expect(listed?.status).toBe('failed');
    const next = await executeCommand(beginConnectCommand, { connector: 'demo' }, o.ctx(), ports);
    expect(next.connectionId).not.toBe(begun.connectionId);
  });

  it('an expired state is refused', async () => {
    const o = await fresh();
    const begun = await executeCommand(beginConnectCommand, { connector: 'demo' }, o.ctx(), ports);
    const later = { ...o.ctx(), now: new Date(Date.now() + 16 * 60_000) };
    await expectError(
      executeQuery(pendingConnectionQuery, { state: begun.state }, later, ports),
      'not_found',
    );
  });
});

describe('the sync engine', () => {
  it('pulls, maps, writes contacts and pushes ours; the broken record lands in the errors inbox', async () => {
    const o = await fresh();
    await withTenant(o.ctx(), (tx) =>
      upsertContactTx(tx, o.ctx(), { email: 'local.only@org.test', name: 'Local Only', source: 'manual' }),
    );
    const { connectionId, authConnectionId } = await connectDemo(o.ctx());
    const r = await runSync(o.orgId, connectionId, deps, ports);
    expect(r).toMatchObject({ status: 'claimed', runStatus: 'partial', connectionStatus: 'active' });
    const detail = await executeQuery(connectionDetailQuery, { connectionId }, o.ctx(), ports);
    expect(detail.runs[0]).toMatchObject({ status: 'partial', pulled: 3, pushed: 1, failed: 1 });
    expect(detail.connection.lastSyncStatus).toBe('partial');
    expect(detail.connection.nextSyncAt?.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
    // Mapped: lower-cased email, trimmed name.
    expect(await contactRow(o.ctx(), 'grace.hopper@demo-remote.test')).toMatchObject({
      name: 'Grace Hopper',
    });
    expect(await contactRow(o.ctx(), 'ada.lovelace@demo-remote.test')).toMatchObject({
      name: 'Ada Lovelace',
    });
    expect(await contactCount(o.ctx())).toBe(4);
    // Ours went out with our origin stamp; the pulled ones were not echoed back.
    const remote = demoRemoteRecords(account(authConnectionId));
    expect(remote).toHaveLength(DEMO_SEED.length + 1);
    expect(remote.find((x) => x.email_address === 'local.only@org.test')).toMatchObject({
      full_name: 'Local Only',
      origin: originStamp(connectionId),
    });
    const [g] = await groups(o.ctx());
    expect(g).toMatchObject({
      connectionId,
      connector: 'demo',
      step: 'map',
      code: 'invalid_value',
      field: 'email',
      count: 1,
    });
    expect(g?.errors[0]).toMatchObject({ externalId: DEMO_BAD_RECORD, attempts: 1, occurrences: 1 });
    expect(g?.errors[0]?.nextRetryAt).not.toBeNull();
    // The error carries the field, never the record's values.
    expect(JSON.stringify(g)).not.toContain('broken-record');
  });

  it('a sync replayed twice writes once (records, links, contacts unchanged)', async () => {
    const o = await fresh();
    const { connectionId, authConnectionId } = await connectDemo(o.ctx());
    await runSync(o.orgId, connectionId, deps, ports);
    const before = await contactRow(o.ctx(), 'katherine.johnson@demo-remote.test');
    const links = await admin.unsafe(
      `select external_id, local_id, remote_version, local_hash, updated_at from integrations.record_links where org_id = $1 order by external_id`,
      [o.orgId],
    );
    const remoteBefore = demoRemoteRecords(account(authConnectionId)).length;
    for (let i = 0; i < 2; i++) {
      // Replay: the cursors go back to the start and every page comes again.
      await withTenant(o.ctx(), (tx) => resetCursorsTx(tx, connectionId));
      const r = await runSync(o.orgId, connectionId, deps, ports, { force: true });
      expect(r.runStatus).toBe('partial');
      const [run] = (await executeQuery(connectionDetailQuery, { connectionId }, o.ctx(), ports)).runs;
      expect(run).toMatchObject({ pulled: 0, pushed: 0, failed: 1 });
      expect(run?.skipped).toBeGreaterThanOrEqual(3);
    }
    expect(await contactCount(o.ctx())).toBe(3);
    expect(await contactRow(o.ctx(), 'katherine.johnson@demo-remote.test')).toEqual(before);
    expect(
      await admin.unsafe(
        `select external_id, local_id, remote_version, local_hash, updated_at from integrations.record_links where org_id = $1 order by external_id`,
        [o.orgId],
      ),
    ).toEqual(links);
    expect(demoRemoteRecords(account(authConnectionId))).toHaveLength(remoteBefore);
    // The broken record is one inbox row, counted three times.
    const [g] = await groups(o.ctx());
    expect(g?.count).toBe(1);
    expect(g?.errors[0]).toMatchObject({ occurrences: 3, attempts: 3 });
  });

  it('loop guards: a remote change comes in once; a local change goes out once and never echoes back', async () => {
    const o = await fresh();
    const { connectionId, authConnectionId } = await connectDemo(o.ctx());
    await runSync(o.orgId, connectionId, deps, ports);
    // Remote edit → pulled.
    demoRemoteUpdate(account(authConnectionId), 'dc_1', { full_name: 'Augusta Ada King' });
    let r = await runSync(o.orgId, connectionId, deps, ports, { force: true });
    let [run] = (await executeQuery(connectionDetailQuery, { connectionId }, o.ctx(), ports)).runs;
    expect(run).toMatchObject({ pulled: 1, pushed: 0 });
    expect(await contactRow(o.ctx(), 'ada.lovelace@demo-remote.test')).toMatchObject({
      name: 'Augusta Ada King',
    });
    // Local edit → pushed with our origin; the provider's new version of it is not pulled back.
    await withTenant(o.ctx(), (tx) =>
      tx.execute(
        sql`update crm.contacts set name = 'Rear Admiral Hopper', updated_at = now() where email_norm = 'grace.hopper@demo-remote.test'`,
      ),
    );
    r = await runSync(o.orgId, connectionId, deps, ports, { force: true });
    expect(r.runStatus).toBe('succeeded');
    [run] = (await executeQuery(connectionDetailQuery, { connectionId }, o.ctx(), ports)).runs;
    expect(run).toMatchObject({ pulled: 0, pushed: 1 });
    const grace = demoRemoteRecords(account(authConnectionId)).find((x) => x.id === 'dc_2');
    expect(grace).toMatchObject({ full_name: 'Rear Admiral Hopper', origin: originStamp(connectionId) });
    const log = account(authConnectionId).log.filter((l) => l.method !== 'GET');
    expect(log.every((l) => l.idempotencyKey?.startsWith('yy-'))).toBe(true);
    // Next run: nothing moves either way.
    await runSync(o.orgId, connectionId, deps, ports, { force: true });
    [run] = (await executeQuery(connectionDetailQuery, { connectionId }, o.ctx(), ports)).runs;
    expect(run).toMatchObject({ pulled: 0, pushed: 0 });
    expect(account(authConnectionId).log.filter((l) => l.method !== 'GET')).toHaveLength(log.length);
  });

  it('concurrency of one: a second runner is busy while the first holds the run', async () => {
    const o = await fresh();
    const { connectionId } = await connectDemo(o.ctx());
    const first = await executeCommand(claimRunCommand, { connectionId, force: false }, sys(o.orgId), ports);
    expect(first.status).toBe('claimed');
    const second = await executeCommand(claimRunCommand, { connectionId, force: true }, sys(o.orgId), ports);
    expect(second).toMatchObject({ status: 'busy', runId: first.runId });
    expect((await runSync(o.orgId, connectionId, deps, ports, { force: true })).status).toBe('busy');
    // A dead runner's lease runs out: the connection is free again.
    const later = new Date(Date.now() + 11 * 60_000);
    const third = await executeCommand(
      claimRunCommand,
      { connectionId, force: true },
      sys(o.orgId, later),
      ports,
    );
    expect(third.status).toBe('claimed');
    const [old] = await admin.unsafe(`select status, error_code from integrations.sync_runs where id = $1`, [
      first.runId,
    ]);
    expect(old).toMatchObject({ status: 'failed', error_code: 'lease_expired' });
    // Two runners at once: exactly one runs.
    const [x, y] = await Promise.all([
      runSync(o.orgId, connectionId, deps, ports, { now: later, force: true }),
      runSync(o.orgId, connectionId, deps, ports, { now: later, force: true }),
    ]);
    expect([x.status, y.status].sort()).toEqual(['busy', 'busy']);
  });

  it('nothing to do: an idle connection is not synced until it is due', async () => {
    const o = await fresh();
    const { connectionId } = await connectDemo(o.ctx());
    await runSync(o.orgId, connectionId, deps, ports);
    // The broken record's retry is due in a minute; the schedule in an hour.
    expect((await runSync(o.orgId, connectionId, deps, ports)).status).toBe('idle');
    const r = await runDueSyncs(o.orgId, deps, ports, { now: new Date(Date.now() + 2 * 60_000) });
    expect(r).toMatchObject([{ status: 'claimed' }]);
    const [run] = (await executeQuery(connectionDetailQuery, { connectionId }, o.ctx(), ports)).runs;
    expect(run?.trigger).toBe('retry');
  });

  it('a provider outage fails the run, opens a connection-level error and backs the schedule off', async () => {
    const o = await fresh();
    const { connectionId, authConnectionId } = await connectDemo(o.ctx());
    fakeIntegrations.failNext(authConnectionId, 503);
    const r = await runSync(o.orgId, connectionId, deps, ports);
    expect(r).toMatchObject({ runStatus: 'failed', connectionStatus: 'active' });
    const detail = await executeQuery(connectionDetailQuery, { connectionId }, o.ctx(), ports);
    expect(detail.runs[0]).toMatchObject({ status: 'failed', errorCode: 'http_503' });
    expect(detail.connection.nextSyncAt?.getTime()).toBeLessThan(Date.now() + 6 * 60_000);
    expect((await groups(o.ctx())).map((g) => `${g.step}:${g.code}`)).toEqual(['pull:http_503']);
    // The provider answers again: the run succeeds and the outage row resolves.
    await runSync(o.orgId, connectionId, deps, ports, { force: true });
    expect((await groups(o.ctx())).map((g) => `${g.step}:${g.code}`)).toEqual(['map:invalid_value']);
    expect((await groups(o.ctx(), 'resolved')).map((g) => g.code)).toContain('http_503');
  });
});

describe('revocation stops within one run', () => {
  it('revoked at the provider: the next run marks the connection revoked and stops', async () => {
    const o = await fresh();
    const { connectionId, authConnectionId } = await connectDemo(o.ctx());
    fakeIntegrations.revokeAtProvider(authConnectionId);
    const r = await runSync(o.orgId, connectionId, deps, ports);
    expect(r).toMatchObject({ runStatus: 'failed', connectionStatus: 'revoked' });
    const detail = await executeQuery(connectionDetailQuery, { connectionId }, o.ctx(), ports);
    expect(detail.connection).toMatchObject({
      status: 'revoked',
      revokeReason: 'provider',
      nextSyncAt: null,
    });
    expect(detail.runs[0]).toMatchObject({ errorCode: 'auth_revoked', pulled: 0 });
    expect(await contactCount(o.ctx())).toBe(0);
    expect((await groups(o.ctx())).map((g) => `${g.step}:${g.code}`)).toEqual(['auth:auth_revoked']);
    expect((await runSync(o.orgId, connectionId, deps, ports, { force: true })).status).toBe('inactive');
    await expectError(executeCommand(requestSyncCommand, { connectionId }, o.ctx(), ports), 'invalid_state');
    const [ev] = await admin.unsafe(
      `select payload from platform.domain_events where org_id = $1 and type = $2`,
      [o.orgId, CONNECTION_REVOKED_EVENT],
    );
    expect(ev?.payload).toMatchObject({ connectionId, reason: 'provider' });
    // A revoked connection's errors cannot be retried; a new connect is allowed.
    const [g] = await groups(o.ctx());
    const retried = await executeCommand(
      retryErrorsCommand,
      { errorIds: g?.errors.map((e) => e.id) ?? [] },
      o.ctx(),
      ports,
    );
    expect(retried).toEqual({ retried: 0, queuedRuns: 0, skipped: 1 });
    await executeCommand(beginConnectCommand, { connector: 'demo' }, o.ctx(), ports);
  });

  it('revoked in the middle of a run: it stops at the refused call', async () => {
    const o = await fresh();
    await withTenant(o.ctx(), (tx) =>
      upsertContactTx(tx, o.ctx(), { email: 'mid@org.test', name: 'Mid', source: 'manual' }),
    );
    const { connectionId, authConnectionId } = await connectDemo(o.ctx());
    // The pull's list answers; the push is refused.
    fakeIntegrations.failNext(authConnectionId, 0, 401);
    const r = await runSync(o.orgId, connectionId, deps, ports);
    expect(r).toMatchObject({ runStatus: 'failed', connectionStatus: 'revoked' });
    const [run] = (await executeQuery(connectionDetailQuery, { connectionId }, o.ctx(), ports)).runs;
    expect(run).toMatchObject({ pulled: 3, pushed: 0, errorCode: 'auth_revoked' });
  });

  it('disconnected by the organizer: queued runs are cancelled, the provider revokes, no run starts', async () => {
    const o = await fresh();
    const { connectionId, authConnectionId } = await connectDemo(o.ctx());
    const out = keep(await executeCommand(disconnectCommand, { connectionId }, o.ctx(), ports));
    expect(out).toEqual({ connectionId, connector: 'demo', providerConfigKey: 'demo', authConnectionId });
    await fakeAuth.revoke({ orgId: o.orgId, connectionId, providerConfigKey: 'demo', authConnectionId });
    expect(account(authConnectionId).revoked).toBe(true);
    const detail = await executeQuery(connectionDetailQuery, { connectionId }, o.ctx(), ports);
    expect(detail.connection).toMatchObject({ status: 'revoked', revokeReason: 'user' });
    expect(detail.runs[0]).toMatchObject({ status: 'cancelled', errorCode: 'disconnected' });
    expect((await runSync(o.orgId, connectionId, deps, ports, { force: true })).status).toBe('inactive');
    await expectError(executeCommand(disconnectCommand, { connectionId }, o.ctx(), ports), 'invalid_state');
  });

  it('a run that sees the connection paused or disconnected mid-way ends as cancelled', async () => {
    const o = await fresh();
    const { connectionId } = await connectDemo(o.ctx());
    const claim = await executeCommand(claimRunCommand, { connectionId, force: true }, sys(o.orgId), ports);
    await executeCommand(setConnectionPausedCommand, { connectionId, paused: true }, o.ctx(), ports);
    const [run] = await admin.unsafe(`select status from integrations.sync_runs where id = $1`, [
      claim.runId,
    ]);
    expect(run?.status).toBe('cancelled');
    expect((await runSync(o.orgId, connectionId, deps, ports, { force: true })).status).toBe('inactive');
    const resumed = await executeCommand(
      setConnectionPausedCommand,
      { connectionId, paused: false },
      o.ctx(),
      ports,
    );
    expect(resumed.status).toBe('active');
    expect((await runSync(o.orgId, connectionId, deps, ports)).runStatus).toBe('partial');
  });
});

describe('field mapping and the errors inbox', () => {
  it('saves validated versions; refuses unknown fields and missing required targets', async () => {
    const o = await fresh();
    const { connectionId } = await connectDemo(o.ctx());
    const base = { connectionId, objectType: 'contacts', direction: 'pull' as const };
    const err = await executeCommand(
      saveMappingCommand,
      { ...base, rules: [{ source: 'company', target: 'name', transform: 'uppercase', default: null }] },
      o.ctx(),
      ports,
    ).catch((e: DomainError) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).details?.issues).toEqual([
      { path: 'rules', code: 'missing_required', field: 'email' },
    ]);
    await expectError(
      executeCommand(
        saveMappingCommand,
        { ...base, rules: [{ source: 'email_address', target: 'email', transform: 'shell', default: null }] },
        o.ctx(),
        ports,
      ),
      'validation_failed',
    );
    const v2 = await executeCommand(
      saveMappingCommand,
      {
        ...base,
        rules: [
          { source: 'email_address', target: 'email', transform: 'lowercase', default: null },
          { source: 'company', target: 'name', transform: 'uppercase', default: 'UNKNOWN' },
        ],
      },
      o.ctx(),
      ports,
    );
    expect(v2.version).toBe(2);
    const versions = await executeQuery(mappingVersionsQuery, base, o.ctx(), ports);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    await runSync(o.orgId, connectionId, deps, ports);
    expect(await contactRow(o.ctx(), 'grace.hopper@demo-remote.test')).toMatchObject({ name: 'NAVY' });
  });

  it('retry after fixing the record at the source resolves it; dismiss closes it', async () => {
    const o = await fresh();
    const { connectionId, authConnectionId } = await connectDemo(o.ctx());
    await runSync(o.orgId, connectionId, deps, ports);
    const [g] = await groups(o.ctx());
    const ids = g?.errors.map((e) => e.id) ?? [];
    demoRemoteUpdate(account(authConnectionId), DEMO_BAD_RECORD, {
      email_address: 'fixed.record@demo-remote.test',
    });
    const retried = await executeCommand(retryErrorsCommand, { errorIds: ids }, o.ctx(), ports);
    expect(retried).toEqual({ retried: 1, queuedRuns: 1, skipped: 0 });
    const r = await runSync(o.orgId, connectionId, deps, ports);
    expect(r.runStatus).toBe('succeeded');
    expect(await groups(o.ctx())).toEqual([]);
    expect((await groups(o.ctx(), 'resolved'))[0]?.errors[0]?.externalId).toBe(DEMO_BAD_RECORD);
    expect(await contactIdByEmailTxFor(o.ctx(), 'fixed.record@demo-remote.test')).not.toBeNull();
    // A new failure → dismiss.
    demoRemoteUpdate(account(authConnectionId), 'dc_3', { email_address: 'not an email' });
    await runSync(o.orgId, connectionId, deps, ports, { force: true });
    const [g2] = await groups(o.ctx());
    expect(g2?.errors[0]?.externalId).toBe('dc_3');
    expect(
      await executeCommand(
        dismissErrorsCommand,
        { errorIds: g2?.errors.map((e) => e.id) ?? [] },
        o.ctx(),
        ports,
      ),
    ).toEqual({ dismissed: 1 });
    expect(await groups(o.ctx())).toEqual([]);
    expect((await groups(o.ctx(), 'dismissed'))[0]?.errors[0]?.externalId).toBe('dc_3');
  });

  it('pause, interval and sync now', async () => {
    const o = await fresh();
    const { connectionId } = await connectDemo(o.ctx());
    const first = await executeCommand(requestSyncCommand, { connectionId }, o.ctx(), ports);
    expect(first.already).toBe(true);
    await runSync(o.orgId, connectionId, deps, ports);
    const again = await executeCommand(requestSyncCommand, { connectionId }, o.ctx(), ports);
    expect(again.already).toBe(false);
    expect(
      await executeCommand(setSyncIntervalCommand, { connectionId, minutes: 15 }, o.ctx(), ports),
    ).toEqual({ minutes: 15 });
    await expectError(
      executeCommand(setSyncIntervalCommand, { connectionId, minutes: 7 }, o.ctx(), ports),
      'validation_failed',
    );
    await executeCommand(setConnectionPausedCommand, { connectionId, paused: true }, o.ctx(), ports);
    const detail = await executeQuery(connectionDetailQuery, { connectionId }, o.ctx(), ports);
    expect(detail.connection).toMatchObject({ status: 'paused', nextSyncAt: null, syncIntervalMinutes: 15 });
    expect(detail.syncing).toBe(false);
    await expectError(executeCommand(requestSyncCommand, { connectionId }, o.ctx(), ports), 'invalid_state');
  });
});

describe('permissions, entitlement and isolation', () => {
  it('viewers see nothing; only owners and admins manage; staff acting as a member cannot connect', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    await expectError(executeQuery(listConnectionsQuery, {}, viewer, ports), 'forbidden');
    await expectError(executeCommand(beginConnectCommand, { connector: 'demo' }, viewer, ports), 'forbidden');
    const [conn] = await executeQuery(listConnectionsQuery, {}, a.ctx(), ports);
    if (!conn) throw new Error('fixture connection');
    await expectError(
      executeCommand(requestSyncCommand, { connectionId: conn.id }, viewer, ports),
      'forbidden',
    );
    await expectError(
      executeCommand(
        beginConnectCommand,
        { connector: 'demo' },
        a.ctx({ impersonatedBy: { staffUserId: uuidv7(), impersonationId: uuidv7() } }),
        ports,
      ),
      'impersonation_blocked',
    );
    // Members never run the engine's commands.
    await expectError(
      executeCommand(claimRunCommand, { connectionId: conn.id, force: true }, a.ctx(), ports),
      'forbidden',
    );
  });

  it('without the integrations module nothing reads, connects or syncs', async () => {
    const o = await fresh();
    const { connectionId } = await connectDemo(o.ctx());
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'integrations', effect: 'revoke', reason: 'test' },
      systemCtx(o.orgId),
      ports,
    );
    await expectError(executeQuery(listConnectionsQuery, {}, o.ctx(), ports), 'module_not_enabled');
    await expectError(
      executeCommand(beginConnectCommand, { connector: 'demo' }, o.ctx(), ports),
      'module_not_enabled',
    );
    expect((await runSync(o.orgId, connectionId, deps, ports, { force: true })).status).toBe('inactive');
  });

  it('a connection, mapping or error of one org is invisible to another', async () => {
    const [conn] = await executeQuery(listConnectionsQuery, {}, a.ctx(), ports);
    if (!conn) throw new Error('fixture connection');
    expect(conn).toMatchObject({ connector: 'demo', status: 'active', openErrors: 1 });
    const bList = await executeQuery(listConnectionsQuery, {}, b.ctx(), ports);
    expect(bList.map((c) => c.id)).not.toContain(conn.id);
    await expectError(
      executeQuery(connectionDetailQuery, { connectionId: conn.id }, b.ctx(), ports),
      'not_found',
    );
    await expectError(
      executeQuery(
        mappingVersionsQuery,
        { connectionId: conn.id, objectType: 'contacts', direction: 'pull' },
        b.ctx(),
        ports,
      ),
      'not_found',
    );
    await expectError(
      executeCommand(
        saveMappingCommand,
        {
          connectionId: conn.id,
          objectType: 'contacts',
          direction: 'pull',
          rules: [{ source: 'email_address', target: 'email', transform: 'none', default: null }],
        },
        b.ctx(),
        ports,
      ),
      'not_found',
    );
    const aErrors = (await groups(a.ctx())).flatMap((g) => g.errors.map((e) => e.id));
    const bErrors = (await groups(b.ctx())).flatMap((g) => g.errors.map((e) => e.id));
    expect(aErrors.length).toBeGreaterThan(0);
    expect(bErrors.filter((id) => aErrors.includes(id))).toEqual([]);
    expect(await executeCommand(retryErrorsCommand, { errorIds: aErrors }, b.ctx(), ports)).toEqual({
      retried: 0,
      queuedRuns: 0,
      skipped: aErrors.length,
    });
    expect(await executeCommand(dismissErrorsCommand, { errorIds: aErrors }, b.ctx(), ports)).toEqual({
      dismissed: 0,
    });
    await expectError(
      executeCommand(disconnectCommand, { connectionId: conn.id }, b.ctx(), ports),
      'not_found',
    );
    // The engine run under org B's context cannot reach org A's connection either.
    await expectError(runSync(b.org.id, conn.id, deps, ports, { force: true }), 'not_found');
  });
});

describe('tokens never leave the port (canary)', () => {
  it('no token in the database, audit rows, outbox events, outputs, errors or logs', async () => {
    const o = await fresh();
    await withTenant(o.ctx(), (tx) =>
      upsertContactTx(tx, o.ctx(), { email: 'canary@org.test', name: 'C', source: 'manual' }),
    );
    const { connectionId, authConnectionId } = await connectDemo(o.ctx());
    await runSync(o.orgId, connectionId, deps, ports);
    fakeIntegrations.failNext(authConnectionId, 500);
    await runSync(o.orgId, connectionId, deps, ports, { force: true });
    fakeIntegrations.expireToken(authConnectionId);
    await runSync(o.orgId, connectionId, deps, ports, { force: true });
    fakeIntegrations.revokeAtProvider(authConnectionId);
    await runSync(o.orgId, connectionId, deps, ports);
    keep(await executeQuery(connectionDetailQuery, { connectionId }, o.ctx(), ports));
    keep(await executeQuery(listConnectionsQuery, {}, o.ctx(), ports));
    await groups(o.ctx());
    const dump = await admin.unsafe(
      `select 'integrations' as src, to_jsonb(t)::text as row from integrations.connections t where org_id = $1
       union all select 'mappings', to_jsonb(t)::text from integrations.field_mappings t where org_id = $1
       union all select 'cursors', to_jsonb(t)::text from integrations.sync_cursors t where org_id = $1
       union all select 'runs', to_jsonb(t)::text from integrations.sync_runs t where org_id = $1
       union all select 'links', to_jsonb(t)::text from integrations.record_links t where org_id = $1
       union all select 'errors', to_jsonb(t)::text from integrations.sync_errors t where org_id = $1
       union all select 'audit', to_jsonb(t)::text from platform.audit_events t where org_id = $1
       union all select 'events', to_jsonb(t)::text from platform.domain_events t where org_id = $1`,
      [o.orgId],
    );
    expect(dump.length).toBeGreaterThan(10);
    const events = dump.filter((d) => d.src === 'events').map((d) => String(d.row));
    expect(events.some((e) => e.includes(SYNC_COMPLETED_EVENT))).toBe(true);
    const everything = [
      ...dump.map((d) => String(d.row)),
      ...outputs.map((x) => JSON.stringify(x)),
      ...thrown.map((e) => `${String(e)} ${JSON.stringify(e)} ${(e as Error)?.stack ?? ''}`),
      ...logged,
    ].join('\n');
    for (const token of [FAKE_ACCESS_TOKEN, FAKE_REFRESH_TOKEN]) expect(everything).not.toContain(token);
    expect(findCanaries(everything).filter((h) => h.column.startsWith('integrations.oauth'))).toEqual([]);
    // The canaries are live: the fake provider does hold and echo them.
    expect(account(authConnectionId).accessToken).toBe(FAKE_ACCESS_TOKEN);
    expect(findCanaries(FAKE_ACCESS_TOKEN)[0]).toMatchObject({
      column: 'integrations.oauth.access_token',
      class: 'secret',
    });
  });
});

async function contactIdByEmailTxFor(ctx: Ctx, email: string) {
  return withTenant(ctx, (tx) => contactIdByEmailTx(tx, email));
}
