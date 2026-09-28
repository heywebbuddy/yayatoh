import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { checkoutTarget, orgUnavailableForEvent, publicEventBySlug } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  catchUpListings,
  listingBySlug,
  orgListings,
  parseSearchParams,
  publicOrganizer,
  searchListings,
  updateSiteSettingsCommand,
} from '@yayatoh/marketplace';
import { startCheckoutCommand } from '@yayatoh/orders';
import { auditExportBulk, consumeEvent, memoryNotifier } from '@yayatoh/platform';
import { surveyRef, surveyToken } from '@yayatoh/surveys';
import {
  getOrganizationQuery,
  managedHostname,
  orgStatusHistoryQuery,
  orgStatusNotice,
  publicLegalPage,
  resolveHost,
  setOrgStatusCommand,
  setSuspensionCommand,
  startImpersonationCommand,
  updateOrganizationCommand,
} from '@yayatoh/tenancy';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
const EXPORT = {
  headers: {
    seq: '#',
    at: 'When',
    actor: 'Who',
    action: 'What',
    targetType: 'Target type',
    targetId: 'Target',
    details: 'Details',
  },
  timeZone: 'UTC',
  actorNames: {},
};

const staff = (o: OrgFixture) =>
  createCtx({ orgId: o.org.id, actor: { type: 'system', name: 'staff:test' } });
const setStatus = (
  o: OrgFixture,
  action: 'suspend' | 'reactivate' | 'terminate',
  reason = 'test: fraud review',
) => executeCommand(setOrgStatusCommand, { action, reason }, staff(o), ports);

const buy = async (o: OrgFixture) => {
  const [t] = await executeQuery(listTicketTypesQuery, { eventId: o.event.id }, o.ctx(), ports);
  if (!t) throw new Error('no ticket type');
  return executeCommand(
    startCheckoutCommand,
    {
      eventId: o.event.id,
      items: [{ ticketTypeId: t.id, quantity: 1 }],
      buyer: { email: 'status@example.test', name: 'Status Buyer' },
    },
    createCtx({ orgId: o.org.id }),
    ports,
  );
};

const rename = (o: OrgFixture, name: string, ctx = o.ctx()) =>
  executeCommand(updateOrganizationCommand, { name }, ctx, ports);

/** Everything the public can read about the org, by its own addresses. */
async function publicFace(o: OrgFixture) {
  const [invitation] = await withTenant(systemCtx(o.org.id), (tx) =>
    tx.execute<{ id: string }>(sql`select id from surveys.invitations order by created_at, id limit 1`),
  );
  return {
    event: (await publicEventBySlug(o.event.slug)) !== null,
    checkout: (await checkoutTarget(o.event.slug)) !== null,
    organizer: (await publicOrganizer(o.org.slug)) !== null,
    host: (await resolveHost(managedHostname(o.org.slug))) !== null,
    legal: (await publicLegalPage(o.org.slug, 'refund')) !== null,
    marketplace: (await searchListings({ ...parseSearchParams({}), orgSlug: o.org.slug })).total > 0,
    listing: (await listingBySlug(o.event.slug)) !== null,
    // A survey link (M3.9a) resolves only for a live org.
    survey: invitation ? (await surveyRef(surveyToken(invitation.id))) !== null : 'no invitation',
  };
}
const ONLINE = {
  event: true,
  checkout: true,
  organizer: true,
  host: true,
  legal: true,
  marketplace: true,
  listing: true,
  survey: true,
};
const OFFLINE = {
  event: false,
  checkout: false,
  organizer: false,
  host: false,
  legal: false,
  marketplace: false,
  listing: false,
  survey: false,
};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  // Both orgs are on the marketplace so the listings are visible cross-tenant.
  for (const o of [a, b]) {
    await executeCommand(
      updateSiteSettingsCommand,
      { listOnMarketplace: true, tenantSite: true },
      o.ctx(),
      ports,
    );
    await catchUpListings(o.org.id);
  }
});
afterAll(closePools);

describe('org status: who may change it (M1.3f)', () => {
  it('only staff (a platform actor) can suspend, reactivate or terminate; owners and viewers are refused', async () => {
    for (const ctx of [a.ctx(), userCtx(a.viewerId, a.org.id)])
      await expect(
        executeCommand(setOrgStatusCommand, { action: 'suspend', reason: 'self-serve' }, ctx, ports),
      ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeQuery(orgStatusHistoryQuery, {}, a.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    // A reason is required.
    await expect(
      executeCommand(setOrgStatusCommand, { action: 'suspend', reason: '  ' }, staff(a), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect((await executeQuery(getOrganizationQuery, {}, a.ctx(), ports)).status).toBe('active');
  });
});

describe('suspend and reactivate', () => {
  it('a suspended org disappears from every public read at once; the other org stays; reactivating brings it back', async () => {
    expect(await publicFace(a)).toEqual(ONLINE);
    expect(await setStatus(a, 'suspend')).toMatchObject({ from: 'active', to: 'suspended' });
    expect(await publicFace(a)).toEqual(OFFLINE);
    expect(await orgUnavailableForEvent(a.event.slug)).toBe(true);
    expect(await orgUnavailableForEvent(b.event.slug)).toBe(false);
    expect(await publicFace(b)).toEqual(ONLINE);

    // Twice is refused (nothing to do), and history keeps the staff note.
    await expect(setStatus(a, 'suspend')).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'not_live' },
    });
    const history = await executeQuery(orgStatusHistoryQuery, {}, staff(a), ports);
    expect(history[0]).toMatchObject({
      action: 'suspend',
      from: 'active',
      to: 'suspended',
      reason: 'test: fraud review',
      changedBy: 'system:staff:test',
    });

    expect(await setStatus(a, 'reactivate', 'test: cleared')).toMatchObject({
      from: 'suspended',
      to: 'active',
    });
    expect(await publicFace(a)).toEqual(ONLINE);
    await expect(setStatus(a, 'reactivate')).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'not_suspended' },
    });
  });

  it('the console is read-only while suspended: members and the public are refused writes, reads work, staff still act', async () => {
    await setStatus(a, 'suspend');
    try {
      await expect(rename(a, 'Renamed while suspended')).rejects.toMatchObject({
        code: 'invalid_state',
        details: { reason: 'org_suspended' },
      });
      await expect(buy(a)).rejects.toMatchObject({
        code: 'invalid_state',
        details: { reason: 'org_suspended' },
      });
      expect((await executeQuery(getOrganizationQuery, {}, a.ctx(), ports)).status).toBe('suspended');
      // Exports still start: organizers can take their data out.
      const op = await executeCommand(
        auditExportBulk.start,
        { selection: { filter: {} }, params: EXPORT },
        a.ctx(),
        ports,
      );
      expect(op.operationId).toBeTruthy();
      // Staff (platform actors) are not refused.
      const paused = await executeCommand(
        setSuspensionCommand,
        { kind: 'pause_messaging', paused: true, reason: 'test: while suspended' },
        staff(a),
        ports,
      );
      expect(paused.changed).toBe(true);
      await executeCommand(
        setSuspensionCommand,
        { kind: 'pause_messaging', paused: false, reason: 'test: lifted' },
        staff(a),
        ports,
      );
      // The other org is untouched.
      expect((await rename(b, 'Bravo Weddings')).name).toBe('Bravo Weddings');
      expect((await buy(b)).order.status).toBe('reserved');
    } finally {
      await setStatus(a, 'reactivate', 'test: done');
    }
    expect((await rename(a, 'Alpha Events')).name).toBe('Alpha Events');
    expect((await buy(a)).order.status).toBe('reserved');
  });

  it('staff may still act as a member of a suspended org (read-only for them too)', async () => {
    await setStatus(a, 'suspend');
    try {
      const r = await executeCommand(
        startImpersonationCommand,
        {
          impersonationId: uuidv7(),
          userId: a.viewerId,
          reason: 'Ticket 7: why am I suspended?',
          expiresAt: new Date(Date.now() + 3600_000),
          memberName: 'Vic Viewer',
        },
        staff(a),
        ports,
      );
      expect(r.role).toBe('viewer');
      const acting = userCtx(a.ownerId, a.org.id, {
        impersonatedBy: { staffUserId: uuidv7(), impersonationId: uuidv7() },
      });
      await expect(rename(a, 'Staff rename', acting)).rejects.toMatchObject({
        code: 'invalid_state',
        details: { reason: 'org_suspended' },
      });
    } finally {
      await setStatus(a, 'reactivate', 'test: done');
    }
  });
});

describe('the marketplace projection follows the status', () => {
  it('drops the org’s listings on suspension and rebuilds them on reactivation; the other org keeps its own', async () => {
    const rows = (o: OrgFixture) =>
      withTenant(systemCtx(o.org.id), (tx) =>
        tx.execute<{ slug: string }>(sql`select slug from marketplace.public_listings order by slug`),
      );
    const before = (await rows(a)).map((r) => r.slug);
    const other = (await rows(b)).map((r) => r.slug);
    expect(before).toContain(a.event.slug);

    await setStatus(a, 'suspend');
    await catchUpListings(a.org.id);
    expect(await rows(a)).toEqual([]);
    expect((await orgListings(a.org.id)).total).toBe(0);
    expect((await rows(b)).map((r) => r.slug)).toEqual(other);

    await setStatus(a, 'reactivate', 'test: back');
    await catchUpListings(a.org.id);
    expect((await rows(a)).map((r) => r.slug)).toEqual(before);
    // Replaying the events changes nothing.
    await catchUpListings(a.org.id);
    expect((await rows(a)).map((r) => r.slug)).toEqual(before);
  });
});

describe('audit, event and notice', () => {
  it('each change is audited in the org (with the staff note), emitted as org.status_changed@1, and the owners are told without the note', async () => {
    const r = await setStatus(a, 'suspend', 'test: audit trail');
    await setStatus(a, 'reactivate', 'test: audit trail done');
    const [audit] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ actor: string; data: Record<string, unknown> }>(
        sql`select actor, data from platform.audit_events where action = 'org.status_change' order by seq desc offset 1 limit 1`,
      ),
    );
    expect(audit).toMatchObject({
      actor: 'system:staff:test',
      data: { statusAction: 'suspend', from: 'active', to: 'suspended', reasonText: 'test: audit trail' },
    });
    const [ev] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string; version: number; payload: Record<string, unknown> }>(
        sql`select id, version, payload from platform.domain_events where type = 'org.status_changed' and payload->>'changeId' = ${r.changeId}`,
      ),
    );
    expect(ev?.version).toBe(1);
    expect(ev?.payload).toEqual({
      orgId: a.org.id,
      changeId: r.changeId,
      action: 'suspend',
      from: 'active',
      to: 'suspended',
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
        params: { url: `https://app.test/o/${a.org.slug}`, status: 'suspended' },
        dedupeKey: `org-status:${r.changeId}`,
        href: '/activity',
      },
    ]);
    expect(JSON.stringify(memory.members)).not.toContain('audit trail');
  });
});

describe('terminate', () => {
  it('is irreversible here, takes the org offline, keeps only personal actions and the owners’ exports; nothing is deleted', async () => {
    const { a: t } = await twoOrgs();
    const [{ n: ordersBefore } = { n: 0 }] = await withTenant(systemCtx(t.org.id), (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from orders.orders`),
    );
    expect(await setStatus(t, 'terminate', 'test: closed on request')).toMatchObject({
      from: 'active',
      to: 'terminated',
    });
    expect(await publicFace(t)).toEqual(OFFLINE);
    for (const action of ['reactivate', 'suspend', 'terminate'] as const)
      await expect(setStatus(t, action)).rejects.toMatchObject({
        code: 'invalid_state',
        details: { reason: 'terminated' },
      });
    await expect(rename(t, 'Closed rename')).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'org_terminated' },
    });
    const exportStart = (ctx: ReturnType<typeof userCtx>) =>
      executeCommand(auditExportBulk.start, { selection: { filter: {} }, params: EXPORT }, ctx, ports);
    // Owners can still take their data out.
    expect((await exportStart(t.ctx())).operationId).toBeTruthy();
    // Staff can't act as a member of a closed org.
    await expect(
      executeCommand(
        startImpersonationCommand,
        {
          impersonationId: uuidv7(),
          userId: t.viewerId,
          reason: 'Ticket 8',
          expiresAt: new Date(Date.now() + 3600_000),
          memberName: 'Vic',
        },
        staff(t),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'org_terminated' } });
    // Nothing was deleted.
    const [{ n: ordersAfter } = { n: 0 }] = await withTenant(systemCtx(t.org.id), (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from orders.orders`),
    );
    expect(ordersAfter).toBe(ordersBefore);
    expect(ordersAfter).toBeGreaterThan(0);
  });
});
