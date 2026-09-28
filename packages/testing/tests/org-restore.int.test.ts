import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  catchUpListings,
  listingBySlug,
  publicOrganizer,
  updateSiteSettingsCommand,
} from '@yayatoh/marketplace';
import { consumeEvent, memoryNotifier } from '@yayatoh/platform';
import {
  apiKeyIdentity,
  getOrganizationQuery,
  orgStatusHistoryQuery,
  orgStatusNotice,
  restoreOrgCommand,
  setOrgStatusCommand,
  setSuspensionCommand,
  suspensionsQuery,
  updateOrganizationCommand,
} from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * Restoring a terminated org (M1.13d; runbook docs/runbooks/restore-terminated-org.md): staff
 * only, with a fresh step-up and a reason; back to the status the termination recorded, and
 * nothing else changed. Every test makes its own orgs.
 */
afterAll(closePools);

const staff = (o: OrgFixture, stepUpAt: Date | null = new Date()) =>
  createCtx({ orgId: o.org.id, actor: { type: 'system', name: 'staff:test' }, stepUpAt });
const setStatus = (o: OrgFixture, action: 'suspend' | 'reactivate' | 'terminate', reason = 'test: status') =>
  executeCommand(setOrgStatusCommand, { action, reason }, staff(o), ports);
const restore = (o: OrgFixture, ctx: Ctx = staff(o), reason = 'test: ticket 42, wrong org closed') =>
  executeCommand(restoreOrgCommand, { reason }, ctx, ports);
const statusOf = async (o: OrgFixture) =>
  (await executeQuery(getOrganizationQuery, {}, staff(o), ports)).status;

async function listedOrgs() {
  const { a, b } = await twoOrgs();
  for (const o of [a, b]) {
    await executeCommand(
      updateSiteSettingsCommand,
      { listOnMarketplace: true, tenantSite: true },
      o.ctx(),
      ports,
    );
    await catchUpListings(o.org.id);
  }
  return { a, b };
}

async function publicFace(o: OrgFixture) {
  await catchUpListings(o.org.id);
  return {
    event: (await publicEventBySlug(o.event.slug)) !== null,
    checkout: (await checkoutTarget(o.event.slug)) !== null,
    organizer: (await publicOrganizer(o.org.slug)) !== null,
    listing: (await listingBySlug(o.event.slug)) !== null,
    apiKey: (await apiKeyIdentity(o.apiKey)) !== null,
  };
}
const ONLINE = { event: true, checkout: true, organizer: true, listing: true, apiKey: true };
const OFFLINE = { event: false, checkout: false, organizer: false, listing: false, apiKey: false };

describe('restoring a terminated org', () => {
  it('only staff, with a fresh step-up and a reason; only a terminated org', async () => {
    const { a } = await twoOrgs();
    await expect(restore(a)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'not_terminated' },
    });
    await setStatus(a, 'terminate', 'test: closed');
    // Owners (even with a fresh sign-in) and viewers are not platform actors.
    await expect(restore(a, a.ctx())).rejects.toMatchObject({ code: 'forbidden' });
    // Staff without a step-up, or one older than 10 minutes, are asked to confirm it's them.
    await expect(restore(a, staff(a, null))).rejects.toMatchObject({ code: 'step_up_required' });
    await expect(restore(a, staff(a, new Date(Date.now() - 11 * 60_000)))).rejects.toMatchObject({
      code: 'step_up_required',
    });
    await expect(restore(a, staff(a), '  ')).rejects.toMatchObject({ code: 'validation_failed' });
    // None of the refusals changed anything or left an audit row.
    expect(await statusOf(a)).toBe('terminated');
    const [n] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.audit_events where action = 'org.status_change' and data->>'statusAction' = 'restore'`,
      ),
    );
    expect(n?.n).toBe(0);
  });

  it('puts an active org back online, audited, announced and told to the owners; a second restore is refused', async () => {
    const { a, b } = await listedOrgs();
    const other = await publicFace(b);
    expect(await publicFace(a)).toEqual(ONLINE);
    const terminated = await setStatus(a, 'terminate', 'test: closed by mistake');
    expect(await publicFace(a)).toEqual(OFFLINE);

    const r = await restore(a);
    expect(r).toMatchObject({ from: 'terminated', to: 'active', terminationId: terminated.changeId });
    expect(await statusOf(a)).toBe('active');
    expect(await publicFace(a)).toEqual(ONLINE);
    expect(await publicFace(b)).toEqual(other);
    // Members can write again.
    expect(
      (await executeCommand(updateOrganizationCommand, { name: 'Restored Org' }, a.ctx(), ports)).name,
    ).toBe('Restored Org');

    const history = await executeQuery(orgStatusHistoryQuery, {}, staff(a), ports);
    expect(history[0]).toMatchObject({
      action: 'restore',
      from: 'terminated',
      to: 'active',
      reason: 'test: ticket 42, wrong org closed',
      changedBy: 'system:staff:test',
    });
    const [audit] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ actor: string; data: Record<string, unknown> }>(
        sql`select actor, data from platform.audit_events where action = 'org.status_change' order by seq desc limit 1`,
      ),
    );
    expect(audit).toEqual({
      actor: 'system:staff:test',
      data: {
        statusAction: 'restore',
        from: 'terminated',
        to: 'active',
        reasonText: 'test: ticket 42, wrong org closed',
        terminationId: terminated.changeId,
      },
    });
    const [ev] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string; payload: Record<string, unknown> }>(
        sql`select id, payload from platform.domain_events where type = 'org.status_changed' and payload->>'changeId' = ${r.changeId}`,
      ),
    );
    expect(ev?.payload).toEqual({
      orgId: a.org.id,
      changeId: r.changeId,
      action: 'restore',
      from: 'terminated',
      to: 'active',
    });
    const memory = memoryNotifier();
    await consumeEvent(orgStatusNotice({ notifier: memory.notifier, appOrigin: 'https://app.test' }), {
      id: ev?.id ?? '',
      orgId: a.org.id,
      type: 'org.status_changed',
      version: 1,
      aggregateType: 'organization',
      aggregateId: a.org.id,
      payload: ev?.payload ?? {},
      logSeq: 0,
    });
    expect(memory.members).toEqual([
      {
        kind: 'tenancy.org-status',
        params: { url: `https://app.test/o/${a.org.slug}`, status: 'reactivated' },
        dedupeKey: `org-status:${r.changeId}`,
        href: '/activity',
      },
    ]);
    expect(JSON.stringify(memory.members)).not.toContain('ticket 42');

    await expect(restore(a)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'not_terminated' },
    });
  });

  it('reverses only the termination: a suspended org comes back suspended, with its kill switches as they were', async () => {
    const { a } = await listedOrgs();
    await executeCommand(
      setSuspensionCommand,
      { kind: 'pause_checkout', paused: true, reason: 'test: chargebacks' },
      staff(a),
      ports,
    );
    await setStatus(a, 'suspend', 'test: review');
    await setStatus(a, 'terminate', 'test: closed');
    const r = await restore(a);
    expect(r).toMatchObject({ from: 'terminated', to: 'suspended' });
    expect(await statusOf(a)).toBe('suspended');
    expect(await publicFace(a)).toEqual(OFFLINE);
    await expect(
      executeCommand(updateOrganizationCommand, { name: 'Still read-only' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'org_suspended' } });
    expect((await executeQuery(suspensionsQuery, {}, a.ctx(), ports)).map((s) => s.kind)).toEqual([
      'pause_checkout',
    ]);
    // Reactivating is the ordinary step afterwards.
    await setStatus(a, 'reactivate', 'test: review cleared');
    expect(await statusOf(a)).toBe('active');
  });

  it('refuses an org terminated without a recorded termination (nothing says what to restore)', async () => {
    const { a } = await twoOrgs();
    const admin = adminClient();
    try {
      await admin`update tenancy.organizations set status = 'terminated' where id = ${a.org.id}`;
    } finally {
      await admin.end();
    }
    await expect(restore(a)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'no_termination_record' },
    });
    expect(await statusOf(a)).toBe('terminated');
  });
});
