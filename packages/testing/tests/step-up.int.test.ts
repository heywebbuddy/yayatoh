import { attendeeLabelBulk } from '@yayatoh/attendees';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { assignEventRoleCommand, createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Command, type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { updateSiteSettingsCommand } from '@yayatoh/marketplace';
import { createNotifier, dispatchDue, inboxQuery, memoryTransports } from '@yayatoh/notifications';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  LARGE_REFUND_MINOR,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import {
  applyAccountEventCommand,
  continuePayoutOnboardingCommand,
  DESTINATION_HOLD_MS,
  payoutAccountQuery,
  payoutDestinationMailer,
  recordPayoutAccountCommand,
  releaseDueSettlementsCommand,
} from '@yayatoh/payments';
import { AUDIT_EXPORT_COLUMNS, auditExportBulk, consumeEvent, memoryNotifier } from '@yayatoh/platform';
import { eraseSubjectCommand, exportSubjectCommand, openRequestCommand } from '@yayatoh/privacy';
import { attendeeExportBulk, BOOKING_EXPORT_COLUMNS, bookingsExportBulk } from '@yayatoh/reports';
import {
  addDomainCommand,
  addMemberCommand,
  changeMemberRoleCommand,
  createApiKeyCommand,
  inviteMemberCommand,
  removeDomainCommand,
  removeMemberCommand,
  revokeApiKeyCommand,
  roleRequiresTwoFactor,
  setPrimaryDomainCommand,
  TWO_FACTOR_ROLES,
  twoFactorRequiredBy,
} from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EXPORT_PARAMS,
  type OrgFixture,
  ports,
  staleCtx,
  systemCtx,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
const tag = uuidv7().slice(-8);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const count = async (o: OrgFixture, query: ReturnType<typeof sql>) => {
  const [r] = await withTenant(systemCtx(o.org.id), (tx) => tx.execute<{ n: number }>(query));
  return r?.n ?? 0;
};

/**
 * The step-up gate on one command: a user whose fresh window has passed gets `step_up_required`
 * and nothing is written (no audit row either); a fresh user gets past the gate (the command
 * may still answer something else, e.g. not_found for a made-up id).
 */
async function expectGate<I, O, R>(
  cmd: Command<I, O, R, TenantTx>,
  input: unknown,
  opts: { fresh?: Ctx; stale?: Ctx } = {},
): Promise<O | null> {
  const fresh = opts.fresh ?? a.ctx();
  const stale = opts.stale ?? staleCtx(fresh);
  const audits = () => count(a, sql`select count(*)::int as n from platform.audit_events`);
  const before = await audits();
  await expect(executeCommand(cmd, input, stale, ports)).rejects.toMatchObject({ code: 'step_up_required' });
  expect(await audits()).toBe(before);
  // Never signed in again at all (no step-up time) is refused the same way.
  await expect(executeCommand(cmd, input, { ...fresh, stepUpAt: null }, ports)).rejects.toMatchObject({
    code: 'step_up_required',
  });
  try {
    return await executeCommand(cmd, input, fresh, ports);
  } catch (err) {
    expect(err).not.toMatchObject({ code: 'step_up_required' });
    return null;
  }
}

describe('step-up: sensitive commands need a re-authentication in the last 10 minutes (M1.2c)', () => {
  it('domains: add, make primary, remove', async () => {
    const added = await expectGate(addDomainCommand, { hostname: `tickets-${tag}.example.test` });
    expect(added).toMatchObject({ hostname: `tickets-${tag}.example.test` });
    const id = (added as { id: string }).id;
    await expectGate(setPrimaryDomainCommand, { domainId: id });
    expect(await expectGate(removeDomainCommand, { domainId: id })).toMatchObject({
      hostname: `tickets-${tag}.example.test`,
    });
  });

  it('access grants: invitations, adding, changing and removing members, event roles', async () => {
    await expectGate(inviteMemberCommand, { email: `grant-${tag}@example.test`, role: 'admin' });
    const userId = uuidv7();
    await expectGate(addMemberCommand, { userId, role: 'viewer' });
    await expectGate(changeMemberRoleCommand, { userId, role: 'manager' });
    await expectGate(assignEventRoleCommand, { eventId: a.event.id, userId, role: 'door_staff' });
    await expectGate(removeMemberCommand, { userId });
  });

  it('API keys: creating and revoking', async () => {
    const created = await expectGate(createApiKeyCommand, {
      name: `Step-up ${tag}`,
      scopes: ['events:read'],
    });
    expect(created).toMatchObject({ name: `Step-up ${tag}`, key: expect.stringMatching(/^yy_live_/) });
    const id = (created as { id: string }).id;
    expect(await expectGate(revokeApiKeyCommand, { apiKeyId: id })).toMatchObject({
      id,
      revokedAt: expect.any(Date),
    });
  });

  it('site settings: only letting a new website embed checkout needs a step-up', async () => {
    const origin = `https://embed-${tag}.example.test`;
    await expectGate(updateSiteSettingsCommand, { embedOrigins: [origin] });
    const stale = staleCtx(a.ctx());
    // The same list again, removing websites, and the other switches: no step-up.
    await expect(
      executeCommand(updateSiteSettingsCommand, { embedOrigins: [origin] }, stale, ports),
    ).resolves.toMatchObject({
      embedOrigins: [origin],
    });
    await expect(
      executeCommand(updateSiteSettingsCommand, { tenantSite: true }, stale, ports),
    ).resolves.toMatchObject({
      tenantSite: true,
    });
    await expect(
      executeCommand(updateSiteSettingsCommand, { embedOrigins: [] }, stale, ports),
    ).resolves.toMatchObject({
      embedOrigins: [],
    });
  });

  it('payouts: setting up the account and continuing onboarding', async () => {
    expect(await expectGate(continuePayoutOnboardingCommand, {})).toEqual({
      accountId: `fakeacct_${a.org.slug}`,
    });
    expect(
      await expectGate(recordPayoutAccountCommand, {
        provider: 'fake',
        accountId: `fakeacct_${a.org.slug}`,
        country: 'US',
      }),
    ).toEqual({ accountId: `fakeacct_${a.org.slug}` });
  });

  it('privacy and audit (M1.14, M6.1c): personal data export, erasure and the audit log export', async () => {
    // Opening a request needs no step-up; fulfilling it does.
    const access = await executeCommand(
      openRequestCommand,
      { email: `stepup-${tag}@example.test`, kind: 'access' },
      staleCtx(a.ctx()),
      ports,
    );
    expect(await expectGate(exportSubjectCommand, { requestId: access.requestId })).toMatchObject({
      requestId: access.requestId,
    });
    expect(
      await expectGate(auditExportBulk.start, {
        selection: { filter: {} },
        params: {
          headers: Object.fromEntries(AUDIT_EXPORT_COLUMNS.map((c) => [c, c])),
          timeZone: 'UTC',
          actorNames: {},
        },
      }),
    ).toMatchObject({ operationId: expect.any(String) });
    // Erasure can't be undone. A made-up address passes the gate and erases nothing.
    const erasure = await executeCommand(
      openRequestCommand,
      { email: `nobody-${tag}@example.test`, kind: 'erasure' },
      a.ctx(),
      ports,
    );
    expect(
      await expectGate(eraseSubjectCommand, {
        requestId: erasure.requestId,
        confirm: `nobody-${tag}@example.test`,
      }),
    ).toMatchObject({ requestId: erasure.requestId });
  });

  it('bulk exports (attendees and bookings), but not other bulk actions', async () => {
    const exp = await expectGate(attendeeExportBulk.start, {
      eventId: a.event.id,
      selection: { filter: {} },
      params: EXPORT_PARAMS,
    });
    expect(exp).toMatchObject({ total: expect.any(Number) });
    await expectGate(bookingsExportBulk.start, {
      eventId: a.event.id,
      selection: { filter: { q: '', filter: 'all' } },
      params: {
        headers: Object.fromEntries(BOOKING_EXPORT_COLUMNS.map((c) => [c, c])),
        statuses: {},
        channels: { platform: 'Online', organizer: 'Organizer' },
      },
    });
    // Labelling is not an export: a stale session may still do it.
    await expect(
      executeCommand(
        attendeeLabelBulk.start,
        { eventId: a.event.id, selection: { filter: {} }, params: { add: ['Stale'] } },
        staleCtx(a.ctx()),
        ports,
      ),
    ).resolves.toMatchObject({ total: expect.any(Number) });
  });

  it('refunds: only large ones (≥ LARGE_REFUND_MINOR or the whole order) need a step-up', async () => {
    const e = await executeCommand(
      createEventCommand,
      {
        name: `Big ${tag}`,
        timezone: 'UTC',
        startsAt: '2028-05-01T18:00:00Z',
        endsAt: '2028-05-01T22:00:00Z',
      },
      a.ctx(),
      ports,
    );
    const ticketType = (name: string, priceMinor: number) =>
      executeCommand(
        createTicketTypeCommand,
        { eventId: e.id, name, priceMinor, quantityTotal: 10 },
        a.ctx(),
        ports,
      );
    const table = await ticketType('Table', LARGE_REFUND_MINOR);
    const seat = await ticketType('Seat', 1_000);
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
    const paidOrder = async (ticketTypeId: string, quantity: number) => {
      const c = await executeCommand(
        startCheckoutCommand,
        {
          eventId: e.id,
          items: [{ ticketTypeId, quantity }],
          buyer: { email: `big-${tag}@example.test`, name: 'Big Buyer' },
        },
        createCtx({ orgId: a.org.id }),
        ports,
      );
      const pi = `fakepi_big_${c.order.id}`;
      await executeCommand(
        attachPaymentCommand,
        { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
        createCtx({ orgId: a.org.id }),
        ports,
      );
      await executeCommand(
        applyProviderEventCommand,
        {
          provider: 'fake',
          id: `fakeevt_big_${c.order.id}`,
          type: 'payment.succeeded',
          providerPaymentId: pi,
          amountMinor: c.order.totalMinor,
          currency: c.order.currency,
          orgId: a.org.id,
          orderId: c.order.id,
        },
        systemCtx(a.org.id),
        ports,
      );
      return c.order;
    };
    const big = await paidOrder(table.id, 2);
    const refunds = (orderId: string) =>
      count(a, sql`select count(*)::int as n from orders.refunds where order_id = ${orderId}`);
    const stale = staleCtx(a.ctx());
    // Small: fine without a step-up.
    await executeCommand(
      startRefundCommand,
      { orderId: big.id, reason: 'goodwill', amountMinor: 100 },
      stale,
      ports,
    );
    expect(await refunds(big.id)).toBe(1);
    // Large amount: refused and rolled back; fine once stepped up.
    const large = { orderId: big.id, reason: 'goodwill' as const, amountMinor: LARGE_REFUND_MINOR };
    await expect(executeCommand(startRefundCommand, large, stale, ports)).rejects.toMatchObject({
      code: 'step_up_required',
    });
    expect(await refunds(big.id)).toBe(1);
    await executeCommand(startRefundCommand, large, a.ctx(), ports);
    expect(await refunds(big.id)).toBe(2);
    // A small order refunded whole is large too; part of it is not.
    const small = await paidOrder(seat.id, 1);
    await expect(
      executeCommand(
        startRefundCommand,
        { orderId: small.id, reason: 'requested_by_customer', amountMinor: small.totalMinor },
        stale,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'step_up_required' });
    expect(await refunds(small.id)).toBe(0);
    await executeCommand(
      startRefundCommand,
      { orderId: small.id, reason: 'requested_by_customer', amountMinor: small.totalMinor - 1 },
      stale,
      ports,
    );
    expect(await refunds(small.id)).toBe(1);
  });

  it('system actors pass (authenticated at their transport); API keys and anonymous callers never do', async () => {
    const now = new Date();
    const satisfied = (ctx: Ctx) => ports.stepUp.satisfied(ctx);
    expect(
      await satisfied(createCtx({ orgId: a.org.id, actor: { type: 'system', name: 'webhook' }, now })),
    ).toBe(true);
    for (const actor of [{ type: 'api_key', keyId: 'k1' } as const, { type: 'anonymous' } as const])
      expect(await satisfied(createCtx({ orgId: a.org.id, actor, now, stepUpAt: now }))).toBe(false);
    const user = { type: 'user', userId: a.ownerId } as const;
    expect(
      await satisfied(createCtx({ actor: user, now, stepUpAt: new Date(now.getTime() - 9 * 60_000) })),
    ).toBe(true);
    expect(
      await satisfied(createCtx({ actor: user, now, stepUpAt: new Date(now.getTime() - 10 * 60_000) })),
    ).toBe(false);
    const hostname = `system-${tag}.example.test`;
    await expect(
      executeCommand(addDomainCommand, { hostname }, systemCtx(a.org.id), ports),
    ).resolves.toMatchObject({
      hostname,
    });
  });

  it('a step-up never crosses tenants: a fresh owner of one org is a stranger in the other', async () => {
    await expect(
      executeCommand(
        addDomainCommand,
        { hostname: `cross-${tag}.example.test` },
        userCtx(a.ownerId, b.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('two-step verification is required for owners, admins and finance (M1.2c)', () => {
  it('the policy: owner, admin and finance only', () => {
    expect([...TWO_FACTOR_ROLES].sort()).toEqual(['admin', 'finance', 'owner']);
    for (const r of ['owner', 'admin', 'finance']) expect(roleRequiresTwoFactor(r)).toBe(true);
    for (const r of ['manager', 'marketing', 'box_office', 'scanner', 'viewer'])
      expect(roleRequiresTwoFactor(r)).toBe(false);
  });

  it('lists the memberships that require it, in any org', async () => {
    expect((await twoFactorRequiredBy(a.ownerId)).map((o) => o.orgId)).toEqual([a.org.id]);
    expect(await twoFactorRequiredBy(a.viewerId)).toEqual([]);
    // A viewer in one org and finance in another: required (the other org decides).
    await executeCommand(addMemberCommand, { userId: a.viewerId, role: 'finance' }, b.ctx(), ports);
    expect(await twoFactorRequiredBy(a.viewerId)).toEqual([
      expect.objectContaining({ orgId: b.org.id, role: 'finance' }),
    ]);
    const managerId = uuidv7();
    await executeCommand(addMemberCommand, { userId: managerId, role: 'manager' }, a.ctx(), ports);
    expect(await twoFactorRequiredBy(managerId)).toEqual([]);
    await executeCommand(changeMemberRoleCommand, { userId: managerId, role: 'admin' }, a.ctx(), ports);
    expect(await twoFactorRequiredBy(managerId)).toEqual([expect.objectContaining({ role: 'admin' })]);
  });
});

describe('24 h hold on a new payout destination (M1.2c)', () => {
  it('connecting an account starts the hold, audits it and emails the owners', async () => {
    const q = await executeQuery(payoutAccountQuery, {}, b.ctx(), ports);
    // The fixture connected b's account "now": it is in its hold.
    expect(q.destinationHoldUntil).toBeInstanceOf(Date);
    const left = (q.destinationHoldUntil?.getTime() ?? 0) - Date.now();
    expect(left).toBeGreaterThan(DESTINATION_HOLD_MS - 10 * 60_000);
    expect(left).toBeLessThanOrEqual(DESTINATION_HOLD_MS);
    expect(
      await count(
        b,
        sql`select count(*)::int as n from platform.domain_events where type = 'payouts.destination_changed'`,
      ),
    ).toBe(1);
    expect(
      await count(
        b,
        sql`select count(*)::int as n from platform.audit_events where action = 'payouts.account'`,
      ),
    ).toBeGreaterThan(0);

    const [evt] = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ id: string; aggregate_id: string; payload: Record<string, unknown> }>(
        sql`select id, aggregate_id, payload from platform.domain_events where type = 'payouts.destination_changed'`,
      ),
    );
    const published = {
      id: evt?.id ?? '',
      orgId: b.org.id,
      type: 'payouts.destination_changed',
      version: 1,
      aggregateType: 'payment_account',
      aggregateId: evt?.aggregate_id ?? '',
      payload: evt?.payload ?? {},
      logSeq: 0,
    };
    const ORIGIN = 'https://app.yayatoh.test';

    // The subscriber asks for a member notification to the owners, linking to the payouts page.
    const memory = memoryNotifier();
    await consumeEvent(payoutDestinationMailer({ notifier: memory.notifier, appOrigin: ORIGIN }), {
      ...published,
      id: uuidv7(),
    });
    expect(memory.members).toEqual([
      expect.objectContaining({
        kind: 'payments.destination-changed',
        href: '/payouts',
        params: expect.objectContaining({
          url: `${ORIGIN}/o/${b.org.slug}/payouts`,
          reason: 'connected',
          holdUntil: q.destinationHoldUntil?.toISOString(),
        }),
      }),
    ]);

    // Through the real notifications core: the owner (not the viewer) gets it in the inbox and by
    // email, once, even when the event is delivered twice.
    const sub = payoutDestinationMailer({ notifier: createNotifier(), appOrigin: ORIGIN });
    await consumeEvent(sub, published);
    await consumeEvent(sub, { ...published, logSeq: 1 });
    const ownerInbox = await executeQuery(inboxQuery, {}, b.ctx(), ports);
    expect(ownerInbox.items.filter((i) => i.kind === 'payments.destination-changed')).toEqual([
      expect.objectContaining({ href: '/payouts' }),
    ]);
    const viewerInbox = await executeQuery(inboxQuery, {}, userCtx(b.viewerId, b.org.id), ports);
    expect(viewerInbox.items.filter((i) => i.kind === 'payments.destination-changed')).toEqual([]);
    const { transports, emails } = memoryTransports();
    await dispatchDue(b.org.id, {
      transports,
      appOrigin: ORIGIN,
      userEmails: async (ids) =>
        new Map(ids.map((id) => [id, id === b.ownerId ? 'owner@example.test' : 'someone@example.test'])),
    });
    const notices = emails.filter((e) => e.subject.startsWith('A new payout account'));
    expect(notices.map((e) => e.to)).toEqual(['owner@example.test']);
    expect(notices[0]?.text).toContain(`${ORIGIN}/o/${b.org.slug}/payouts`);
    expect(notices[0]?.text).toContain('no money is sent to it before');
  });

  it('no transfer goes to the new destination until the hold ends', async () => {
    // Enabled at the provider during the hold.
    await executeCommand(
      applyAccountEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_hold_${tag}`,
        type: 'account.updated',
        orgId: b.org.id,
        account: {
          accountId: `fakeacct_${b.org.slug}`,
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
          requirementsDue: [],
          country: 'US',
          defaultCurrency: 'usd',
        },
      },
      systemCtx(b.org.id),
      ports,
    );
    const at = (ms: number) => ({ ...systemCtx(b.org.id), now: new Date(Date.now() + ms) });
    const during = await executeCommand(releaseDueSettlementsCommand, {}, at(60 * 60_000), ports);
    expect(during.ready).toEqual([]);
    expect(during.destinationHoldUntil).toBeInstanceOf(Date);
    // The fixture's settlement still waits (for the destination), it is not lost.
    expect(
      await count(
        b,
        sql`select count(*)::int as n from payments.settlements where status = 'waiting_account'`,
      ),
    ).toBeGreaterThan(0);
    const after = await executeCommand(
      releaseDueSettlementsCommand,
      {},
      at(DESTINATION_HOLD_MS + 60_000),
      ports,
    );
    expect(after.destinationHoldUntil).toBeNull();
    expect(after.ready.length).toBeGreaterThan(0);
    expect(after.ready.every((r) => r.destinationAccountId === `fakeacct_${b.org.slug}`)).toBe(true);
  });
});
