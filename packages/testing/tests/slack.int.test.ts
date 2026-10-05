import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  addDays,
  connectionDetailQuery,
  disconnectCommand,
  fakeIntegrations,
  fakeSlackMessages,
  listConnectionsQuery,
  localDay,
  nextDigestAt,
  queueSlackTestCommand,
  runSlackDispatch,
  saveSlackSettingsCommand,
  slackAlertsSubscriber,
  slackPanelQuery,
  slackPiiProblems,
} from '@yayatoh/integrations';
import {
  type Ctx,
  createCtx,
  DomainError,
  executeCommand,
  executeQuery,
  uuidv7,
  zonedTimeToUtc,
} from '@yayatoh/kernel';
import { createNotifier } from '@yayatoh/notifications';
import { catchUpSubscriber, consumeEvent, recentEventsTx } from '@yayatoh/platform';
import { addMemberCommand, organizationDefaultsTx } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AlertScenario,
  alertScenario,
  bareOrg,
  connectSlack,
  fakeAuth,
  type OrgFixture,
  ports,
  systemCtx,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

/**
 * M6.4c Slack on real Postgres with the fake `IntegrationAuth` and the fake Slack API: the test
 * alert, alerts from the M3.2b engine, the daily digest (once per day per channel across retries
 * and DST), revocation, the finance opt-in, no personal data, permissions and isolation.
 */

let a: OrgFixture;
let b: OrgFixture;
let s: AlertScenario;
const deps = { auth: fakeAuth, appOrigin: 'https://app.yayatoh.test' };
const tag = uuidv7().slice(-8);
let n = 0;

const slackConnectionOf = async (ctx: Ctx) => {
  const list = await executeQuery(listConnectionsQuery, {}, ctx, ports);
  const c = list.find((x) => x.connector === 'slack');
  if (!c) throw new Error('no slack connection');
  return c.id;
};
const accountOf = (connectionId: string) => {
  const acc = fakeIntegrations.accountFor(connectionId);
  if (!acc) throw new Error('no fake account');
  return acc;
};
const posted = (connectionId: string) => fakeSlackMessages(accountOf(connectionId));
const settings = (connectionId: string, over: Partial<Record<string, unknown>> = {}) => ({
  connectionId,
  channelId: 'C01GENERAL',
  channelName: 'general',
  alertsEnabled: true,
  alertMinSeverity: 'warning' as const,
  digestEnabled: true,
  digestTime: '08:00',
  includeFinance: false,
  ...over,
});
const rows = (orgId: string, connectionId: string) =>
  withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ kind: string; status: string; dedupe_key: string; error_code: string | null }>(
      sql`select kind, status, dedupe_key, error_code from integrations.slack_messages where connection_id = ${connectionId}::uuid order by created_at, id`,
    ),
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  s = await alertScenario(a.org.id, a.ctx(), { notifier: createNotifier() });
}, 240_000);

afterAll(async () => {
  await closePools();
});

describe('Slack: test alert and alerts from the engine', () => {
  it('the test alert queued by the fixture goes to the picked channel once', async () => {
    const id = await slackConnectionOf(a.ctx());
    const r = await runSlackDispatch(a.org.id, deps, ports);
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const tests = posted(id).filter((m) => m.text.startsWith('Test alert from'));
    expect(tests).toHaveLength(1);
    expect(tests[0]?.channel).toBe('C01GENERAL');
    const again = await runSlackDispatch(a.org.id, deps, ports);
    expect(again.sent).toBe(0);
    expect(posted(id).filter((m) => m.text.startsWith('Test alert from'))).toHaveLength(1);
    const panel = await executeQuery(slackPanelQuery, { connectionId: id }, a.ctx(), ports);
    expect(panel.settings).toMatchObject({
      channelId: 'C01GENERAL',
      channelName: 'general',
      digestEnabled: true,
    });
    expect(panel.messages.find((m) => m.kind === 'test')?.status).toBe('sent');
  });

  it('alerts at or above the threshold reach the channel once; replays and re-evaluations add nothing', async () => {
    const id = await slackConnectionOf(a.ctx());
    const queued = await catchUpSubscriber(slackAlertsSubscriber, a.org.id);
    expect(queued).toBeGreaterThanOrEqual(4);
    const alertRows = (await rows(a.org.id, id)).filter((r) => r.kind === 'alert');
    expect(alertRows.length).toBeGreaterThanOrEqual(1);
    const before = posted(id).length;
    const r = await runSlackDispatch(a.org.id, deps, ports);
    expect(r.sent).toBe(alertRows.length);
    const texts = posted(id)
      .slice(before)
      .map((m) => m.text);
    expect(texts).toEqual(
      expect.arrayContaining([`Critical: Three check-in devices are offline (${s.eventName})`]),
    );
    // Replaying the outbox (the same events handed over again) queues and sends nothing.
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['alerts.alert_notified'], 3_600_000),
    );
    expect(events.length).toBeGreaterThanOrEqual(4);
    for (const e of events) expect(await consumeEvent(slackAlertsSubscriber, e)).toBe(false);
    expect(await catchUpSubscriber(slackAlertsSubscriber, a.org.id)).toBe(0);
    expect((await runSlackDispatch(a.org.id, deps, ports)).sent).toBe(0);
    expect(posted(id).length).toBe(before + alertRows.length);
  });

  it('carries no personal data beyond names (no emails, phones or amounts)', async () => {
    const id = await slackConnectionOf(a.ctx());
    for (const m of posted(id)) {
      const message = { text: m.text, blocks: m.blocks as never };
      expect(slackPiiProblems(message)).toEqual([]);
      expect(JSON.stringify(m.blocks)).not.toMatch(/@[a-z0-9-]+\.(test|com)/i);
      expect(JSON.stringify(m.blocks)).not.toMatch(/\$\d/);
    }
  });
});

describe('Slack: the daily digest', () => {
  const zoneOf = async (orgId: string) =>
    (await withTenant(systemCtx(orgId), (tx) => organizationDefaultsTx(tx, orgId)))?.timezone ?? 'UTC';

  it('goes out once per day per channel across retries, concurrent passes and DST', async () => {
    const org = await bareOrg(`slack-dig-${tag}-${++n}`, `Slack digest ${n}`);
    const zone = await zoneOf(org.orgId);
    expect(zone).toBe('America/New_York');
    const at = (iso: string) => createCtx({ ...org.ctx(), now: new Date(iso) });
    const { connectionId } = await connectSlack(at('2026-03-06T12:00:00Z'));
    await executeCommand(
      saveSlackSettingsCommand,
      settings(connectionId, { digestTime: '02:30', alertsEnabled: false }),
      at('2026-03-06T12:00:00Z'),
      ports,
    );
    // Every 30 minutes from 6 to 10 March (spring forward on the 8th: 02:30 does not exist), each
    // pass twice and the second time alongside a failing post that is retried a minute later.
    const run = (now: Date) => runSlackDispatch(org.orgId, deps, ports, { now });
    let failedOnce = false;
    for (
      let t = Date.parse('2026-03-06T12:00:00Z');
      t < Date.parse('2026-03-10T12:00:00Z');
      t += 30 * 60_000
    ) {
      const now = new Date(t);
      if (!failedOnce && localDay(now, zone) === '2026-03-08') {
        fakeIntegrations.failNext(accountOf(connectionId).authConnectionId, 503);
        failedOnce = true;
      }
      await Promise.all([run(now), run(now)]);
      await run(new Date(t + 61_000));
    }
    const digests = posted(connectionId).filter((m) => m.text.startsWith('Daily digest'));
    // Digests for the 7th, 8th, 9th and 10th (local), the 8th's after one failed attempt.
    expect(digests).toHaveLength(4);
    const keys = (await rows(org.orgId, connectionId)).filter((r) => r.kind === 'digest');
    expect(keys.map((k) => k.dedupe_key)).toEqual([
      'digest:2026-03-07',
      'digest:2026-03-08',
      'digest:2026-03-09',
      'digest:2026-03-10',
    ]);
    expect(keys.every((k) => k.status === 'sent')).toBe(true);
    expect(failedOnce).toBe(true);
  }, 120_000);

  it('the fall-back day (01:30 twice) gets exactly one digest', async () => {
    const org = await bareOrg(`slack-dig-${tag}-${++n}`, `Slack digest ${n}`);
    const at = (iso: string) => createCtx({ ...org.ctx(), now: new Date(iso) });
    const { connectionId } = await connectSlack(at('2026-10-30T12:00:00Z'));
    await executeCommand(
      saveSlackSettingsCommand,
      settings(connectionId, { digestTime: '01:30' }),
      at('2026-10-30T12:00:00Z'),
      ports,
    );
    for (let t = Date.parse('2026-10-30T12:00:00Z'); t < Date.parse('2026-11-02T12:00:00Z'); t += 20 * 60_000)
      await runSlackDispatch(org.orgId, deps, ports, { now: new Date(t) });
    const keys = (await rows(org.orgId, connectionId))
      .filter((r) => r.kind === 'digest')
      .map((r) => r.dedupe_key);
    expect(keys).toEqual(['digest:2026-10-31', 'digest:2026-11-01', 'digest:2026-11-02']);
    expect(posted(connectionId).filter((m) => m.text.startsWith('Daily digest'))).toHaveLength(3);
  }, 120_000);

  it('a digest whose time passed long ago (worker down) is skipped, not sent late', async () => {
    const org = await bareOrg(`slack-dig-${tag}-${++n}`, `Slack digest ${n}`);
    const at = (iso: string) => createCtx({ ...org.ctx(), now: new Date(iso) });
    const { connectionId } = await connectSlack(at('2026-06-01T00:00:00Z'));
    await executeCommand(saveSlackSettingsCommand, settings(connectionId), at('2026-06-01T00:00:00Z'), ports);
    const r = await runSlackDispatch(org.orgId, deps, ports, { now: new Date('2026-06-03T12:00:00Z') });
    expect(r.queued).toBe(0);
    expect(posted(connectionId)).toHaveLength(0);
    const panel = await executeQuery(slackPanelQuery, { connectionId }, at('2026-06-03T12:00:00Z'), ports);
    expect(panel.settings.digestNextAt?.toISOString()).toBe('2026-06-04T12:00:00.000Z');
  });

  it('shows the day’s sales and check-ins; amounts only for the connection owner’s opt-in', async () => {
    const zone = await zoneOf(b.org.id);
    const id = await slackConnectionOf(b.ctx());
    const today = localDay(new Date(), zone);
    // Saved late "today", so the next digest is tomorrow morning and covers today (the fixture's orders).
    const late = createCtx({ ...b.ctx(), now: zonedTimeToUtc(`${today}T23:00`, zone) });
    await executeCommand(saveSlackSettingsCommand, settings(id, { alertsEnabled: false }), late, ports);
    const when = nextDigestAt(late.now, '08:00', zone);
    expect(localDay(when, zone)).toBe(addDays(today, 1));
    await runSlackDispatch(b.org.id, deps, ports, { now: new Date(when.getTime() + 60_000) });
    const plain = posted(id)
      .filter((m) => m.text.startsWith('Daily digest'))
      .at(-1);
    expect(plain?.text).toContain('Daily digest');
    const body = JSON.stringify(plain?.blocks);
    expect(body).toMatch(/\d+ new orders?/);
    expect(body).not.toContain('Revenue');
    expect(body).not.toMatch(/\$\d/);

    // The owner connected it and has finance access: they may opt in, and amounts appear.
    await executeCommand(
      saveSlackSettingsCommand,
      settings(id, { includeFinance: true, alertsEnabled: false }),
      late,
      ports,
    );
    await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute(
        sql`delete from integrations.slack_messages where connection_id = ${id}::uuid and kind = 'digest'`,
      ),
    );
    await runSlackDispatch(b.org.id, deps, ports, { now: new Date(when.getTime() + 120_000) });
    const finance = posted(id)
      .filter((m) => m.text.startsWith('Daily digest'))
      .at(-1);
    expect(JSON.stringify(finance?.blocks)).toContain('Revenue');
  });

  it('only the connection’s owner with finance access can switch amounts on', async () => {
    const id = await slackConnectionOf(a.ctx());
    const admin = uuidv7();
    const finance = uuidv7();
    await executeCommand(addMemberCommand, { userId: admin, role: 'admin' }, a.ctx(), ports);
    await executeCommand(addMemberCommand, { userId: finance, role: 'finance' }, a.ctx(), ports);
    const err = await executeCommand(
      saveSlackSettingsCommand,
      settings(id, { includeFinance: true }),
      userCtx(admin, a.org.id),
      ports,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('forbidden');
    expect((err as DomainError).details?.reason).toBe('finance_owner_only');
    // Finance members do not manage integrations at all.
    await expect(
      executeCommand(saveSlackSettingsCommand, settings(id), userCtx(finance, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const panel = await executeQuery(slackPanelQuery, { connectionId: id }, userCtx(admin, a.org.id), ports);
    expect(panel.settings.financeAllowed).toBe(false);
    expect(
      (await executeQuery(slackPanelQuery, { connectionId: id }, a.ctx(), ports)).settings.financeAllowed,
    ).toBe(true);
  });
});

describe('Slack: revocation, permissions, isolation', () => {
  it('a connection revoked at Slack stops sending on the next run (and is shown revoked)', async () => {
    const org = await bareOrg(`slack-rev-${tag}-${++n}`, `Slack revoke ${n}`);
    const { connectionId, authConnectionId } = await connectSlack(org.ctx());
    await executeCommand(saveSlackSettingsCommand, settings(connectionId), org.ctx(), ports);
    await executeCommand(queueSlackTestCommand, { connectionId }, org.ctx(), ports);
    fakeIntegrations.revokeAtProvider(authConnectionId);
    const r = await runSlackDispatch(org.orgId, deps, ports);
    expect(r).toMatchObject({ sent: 0, revoked: [connectionId] });
    expect(posted(connectionId)).toHaveLength(0);
    const detail = await executeQuery(connectionDetailQuery, { connectionId }, org.ctx(), ports);
    expect(detail.connection.status).toBe('revoked');
    expect(detail.connection.revokeReason).toBe('provider');
    expect((await rows(org.orgId, connectionId)).map((x) => x.status)).toEqual(['cancelled']);
    await expect(
      executeCommand(queueSlackTestCommand, { connectionId }, org.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('a connection disconnected by the organizer cancels what was queued', async () => {
    const org = await bareOrg(`slack-rev-${tag}-${++n}`, `Slack revoke ${n}`);
    const { connectionId } = await connectSlack(org.ctx());
    await executeCommand(saveSlackSettingsCommand, settings(connectionId), org.ctx(), ports);
    await executeCommand(queueSlackTestCommand, { connectionId }, org.ctx(), ports);
    await executeCommand(disconnectCommand, { connectionId }, org.ctx(), ports);
    const r = await runSlackDispatch(org.orgId, deps, ports);
    expect(r).toMatchObject({ sent: 0, cancelled: 1 });
    expect(posted(connectionId)).toHaveLength(0);
    expect((await rows(org.orgId, connectionId))[0]).toMatchObject({
      status: 'cancelled',
      error_code: 'connection_inactive',
    });
  });

  it('a test needs a channel; a refused channel fails without retrying', async () => {
    const org = await bareOrg(`slack-ch-${tag}-${++n}`, `Slack channel ${n}`);
    const { connectionId } = await connectSlack(org.ctx());
    await expect(
      executeCommand(queueSlackTestCommand, { connectionId }, org.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'no_channel' } });
    await executeCommand(
      saveSlackSettingsCommand,
      settings(connectionId, { channelId: 'C03DOORS', channelName: 'door-team' }),
      org.ctx(),
      ports,
    );
    await executeCommand(queueSlackTestCommand, { connectionId }, org.ctx(), ports);
    expect((await runSlackDispatch(org.orgId, deps, ports)).failed).toBe(1);
    expect((await rows(org.orgId, connectionId))[0]).toMatchObject({
      status: 'failed',
      error_code: 'not_in_channel',
    });
    expect(
      (await runSlackDispatch(org.orgId, deps, ports, { now: new Date(Date.now() + 3_600_000) })).failed,
    ).toBe(0);
  });

  it('viewers cannot see it, managers cannot change it, and validation holds', async () => {
    const id = await slackConnectionOf(a.ctx());
    await expect(
      executeQuery(slackPanelQuery, { connectionId: id }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const manager = uuidv7();
    await executeCommand(addMemberCommand, { userId: manager, role: 'manager' }, a.ctx(), ports);
    await executeQuery(slackPanelQuery, { connectionId: id }, userCtx(manager, a.org.id), ports);
    await expect(
      executeCommand(saveSlackSettingsCommand, settings(id), userCtx(manager, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(queueSlackTestCommand, { connectionId: id }, userCtx(manager, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    for (const bad of [{ channelId: 'general' }, { digestTime: '24:00' }, { alertMinSeverity: 'loud' }])
      await expect(
        executeCommand(saveSlackSettingsCommand, settings(id, bad), a.ctx(), ports),
      ).rejects.toMatchObject({ code: 'validation_failed' });
    // The demo connection is not a Slack one.
    const demo = (await executeQuery(listConnectionsQuery, {}, a.ctx(), ports)).find(
      (c) => c.connector === 'demo',
    );
    await expect(
      executeQuery(slackPanelQuery, { connectionId: demo?.id ?? '' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('another org can neither see nor send through it', async () => {
    const id = await slackConnectionOf(a.ctx());
    await expect(executeQuery(slackPanelQuery, { connectionId: id }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeCommand(saveSlackSettingsCommand, settings(id), b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    const seen = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select (select count(*) from integrations.slack_settings where connection_id = ${id}::uuid)::int
             + (select count(*) from integrations.slack_messages where connection_id = ${id}::uuid)::int as n`,
      ),
    );
    expect(seen[0]?.n).toBe(0);
    // b's pass never touches a's queue.
    const before = (await rows(a.org.id, id)).length;
    await executeCommand(queueSlackTestCommand, { connectionId: id }, a.ctx(), ports);
    await runSlackDispatch(b.org.id, deps, ports);
    const after = await rows(a.org.id, id);
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)?.status).toBe('pending');
  });
});
