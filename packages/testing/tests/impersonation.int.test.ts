import * as ai from '@yayatoh/ai';
import * as attendees from '@yayatoh/attendees';
import * as billing from '@yayatoh/billing';
import * as checkin from '@yayatoh/checkin';
import * as crm from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import * as events from '@yayatoh/events';
import * as forms from '@yayatoh/forms';
import {
  COMMAND_CATEGORIES,
  type Command,
  type Ctx,
  createCtx,
  executeCommand,
  executeQuery,
  type Query,
  uuidv7,
} from '@yayatoh/kernel';
import * as marketplace from '@yayatoh/marketplace';
import * as media from '@yayatoh/media';
import * as messaging from '@yayatoh/messaging';
import * as notifications from '@yayatoh/notifications';
import * as orders from '@yayatoh/orders';
import * as payments from '@yayatoh/payments';
import * as platform from '@yayatoh/platform';
import { auditLogQuery, consumeEvent, memoryNotifier } from '@yayatoh/platform';
import * as privacy from '@yayatoh/privacy';
import * as program from '@yayatoh/program';
import * as reports from '@yayatoh/reports';
import * as seating from '@yayatoh/seating';
import * as templates from '@yayatoh/templates';
import * as tenancy from '@yayatoh/tenancy';
import {
  addMemberCommand,
  changeMemberRoleCommand,
  endImpersonationCommand,
  impersonationNotice,
  inviteMemberCommand,
  removeMemberCommand,
  startImpersonationCommand,
} from '@yayatoh/tenancy';
import * as ticketing from '@yayatoh/ticketing';
import * as venues from '@yayatoh/venues';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
const tag = uuidv7().slice(-8);
const staffUserId = uuidv7();

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const impersonatedBy = () => ({ staffUserId, impersonationId: uuidv7() });
/** The owner, freshly signed in, but really platform staff acting as them. */
const acting = (o: OrgFixture = a) => o.ctx({ impersonatedBy: impersonatedBy() });

const MODULES = {
  ai,
  attendees,
  billing,
  checkin,
  crm,
  events,
  forms,
  marketplace,
  media,
  messaging,
  notifications,
  orders,
  payments,
  platform,
  privacy,
  program,
  reports,
  seating,
  templates,
  tenancy,
  ticketing,
  venues,
};

type AnyCommand = Command<unknown, unknown, unknown, unknown>;
type AnyQuery = Query<unknown, unknown, unknown, unknown>;

/** Every command and query the modules export (bulk actions export theirs inside an object). */
function registry() {
  const commands = new Map<string, AnyCommand>();
  const queries = new Map<string, AnyQuery>();
  const visit = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 1) return;
    const kind = (v as { kind?: unknown }).kind;
    const name = (v as { name?: unknown }).name;
    if (kind === 'command' && typeof name === 'string') commands.set(name, v as AnyCommand);
    else if (kind === 'query' && typeof name === 'string') queries.set(name, v as AnyQuery);
    else for (const inner of Object.values(v)) visit(inner, depth + 1);
  };
  for (const mod of Object.values(MODULES)) for (const v of Object.values(mod)) visit(v, 0);
  return { commands, queries };
}

const audits = async (o: OrgFixture) => {
  const [r] = await withTenant(systemCtx(o.org.id), (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from platform.audit_events`),
  );
  return r?.n ?? 0;
};

describe('impersonation: the pipeline refuses money, export and delete (M1.2e)', () => {
  const { commands, queries } = registry();
  const flagged = [...commands.values()].filter((c) => c.category);

  it('the registry sees the modules’ commands', () => {
    expect(commands.size).toBeGreaterThan(100);
    expect(flagged.length).toBeGreaterThan(15);
  });

  it('every command that refunds, pays out, transfers, exports, deletes or erases carries its category', () => {
    const MONEY = /(refund|payout|transfer|settlement)/i;
    const DELETE = /\.(delete|remove|erase)[A-Z]|\.retention$/;
    const missing: string[] = [];
    for (const [name, c] of commands) {
      const want = MONEY.test(name)
        ? 'money'
        : DELETE.test(name)
          ? 'delete'
          : /\.start[A-Z]/.test(name) && /(Csv|Export)$/.test(name)
            ? 'export'
            : null;
      if (want && c.category !== want) missing.push(`${name} (${c.category ?? 'none'} ≠ ${want})`);
    }
    expect(missing).toEqual([]);
    // Every bulk action that writes a file is an export, and so is downloading its file.
    const exportStarts = [...commands.values()].filter((c) => c.category === 'export').map((c) => c.name);
    expect(exportStarts).toEqual(
      expect.arrayContaining([
        'platform.startAuditCsv',
        'privacy.startDsarExport',
        'reports.startAttendeesCsv',
        'reports.startBookingsCsv',
      ]),
    );
    const files = [...queries.values()].filter((q) => q.category === 'export').map((q) => q.name);
    expect(files).toEqual(
      expect.arrayContaining([
        'platform.auditCsvFile',
        'privacy.dsarExportFile',
        'reports.attendeesCsvFile',
        'reports.bookingsCsvFile',
        'attendees.importFailures',
        'reports.disputeEvidencePacket',
      ]),
    );
    const money = flagged.filter((c) => c.category === 'money').map((c) => c.name);
    expect(money).toEqual(
      expect.arrayContaining([
        'orders.startRefund',
        'orders.startPolicyOverrideRefund',
        'orders.completeRefund',
        'orders.setRefundPolicy',
        'payments.markOrgEvidenceSubmitted',
        'payments.recordPayoutAccount',
        'payments.continuePayoutOnboarding',
        'payments.recordTransfer',
        'payments.recordTransferReversal',
        'payments.releaseDueSettlements',
      ]),
    );
    expect(flagged.filter((c) => c.category === 'delete').map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'privacy.eraseSubject',
        'tenancy.removeMember',
        'tenancy.removeDomain',
        'media.removeMedia',
        'media.removeLogo',
        'program.deleteSession',
      ]),
    );
  });

  it('each flagged command is refused while impersonating, with its category, and writes nothing', async () => {
    const before = await audits(a);
    for (const c of flagged) {
      await expect(executeCommand(c, {}, acting(), ports), c.name).rejects.toMatchObject({
        code: 'impersonation_blocked',
        details: { reason: c.category },
      });
    }
    for (const q of [...queries.values()].filter((x) => x.category))
      await expect(executeQuery(q, { operationId: uuidv7() }, acting(), ports), q.name).rejects.toMatchObject(
        {
          code: 'impersonation_blocked',
        },
      );
    expect(await audits(a)).toBe(before);
    expect(COMMAND_CATEGORIES).toEqual(['money', 'export', 'delete']);
  });

  it('an impersonator cannot refund a real paid order (roadmap acceptance); the owner can', async () => {
    const e = await executeCommand(
      events.createEventCommand,
      {
        name: `Imp ${tag}`,
        timezone: 'UTC',
        startsAt: '2028-06-01T18:00:00Z',
        endsAt: '2028-06-01T22:00:00Z',
      },
      a.ctx(),
      ports,
    );
    const tt = await executeCommand(
      ticketing.createTicketTypeCommand,
      { eventId: e.id, name: 'Seat', priceMinor: 2_000, quantityTotal: 10 },
      a.ctx(),
      ports,
    );
    await executeCommand(
      events.transitionEventCommand,
      { eventId: e.id, transition: 'publish' },
      a.ctx(),
      ports,
    );
    const c = await executeCommand(
      orders.startCheckoutCommand,
      {
        eventId: e.id,
        items: [{ ticketTypeId: tt.id, quantity: 1 }],
        buyer: { email: `imp-${tag}@example.test`, name: 'Imp Buyer' },
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    const pi = `fakepi_imp_${c.order.id}`;
    await executeCommand(
      orders.attachPaymentCommand,
      { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    await executeCommand(
      orders.applyProviderEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_imp_${c.order.id}`,
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
    const input = { orderId: c.order.id, reason: 'goodwill' as const, amountMinor: 100 };
    await expect(executeCommand(orders.startRefundCommand, input, acting(), ports)).rejects.toMatchObject({
      code: 'impersonation_blocked',
      details: { reason: 'money' },
    });
    const refunds = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from orders.refunds where order_id = ${c.order.id}`,
      ),
    );
    expect(refunds[0]?.n).toBe(0);
    await expect(executeCommand(orders.startRefundCommand, input, a.ctx(), ports)).resolves.toBeTruthy();
  });

  it('step-up can’t be satisfied: step-up commands and data-decided step-ups are refused', async () => {
    await expect(
      executeCommand(
        inviteMemberCommand,
        { email: `imp-${tag}@example.test`, role: 'viewer' },
        acting(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'impersonation_blocked', details: { reason: 'step_up' } });
    await expect(
      executeCommand(changeMemberRoleCommand, { userId: a.viewerId, role: 'manager' }, acting(), ports),
    ).rejects.toMatchObject({ code: 'impersonation_blocked', details: { reason: 'step_up' } });
  });

  it('allowed commands run and their audit rows name the staff member next to the member', async () => {
    const ctx = acting();
    const created = await executeCommand(
      events.createEventCommand,
      {
        name: `By staff ${tag}`,
        timezone: 'UTC',
        startsAt: '2028-07-01T18:00:00Z',
        endsAt: '2028-07-01T20:00:00Z',
      },
      ctx,
      ports,
    );
    const log = await executeQuery(auditLogQuery, { filter: {}, limit: 20 }, a.ctx(), ports);
    const row = log.entries.find((e) => e.targetId === created.id);
    expect(row).toMatchObject({
      actor: `user:${a.ownerId}`,
      details: { impersonatedBy: `staff:${staffUserId}` },
    });
    const [raw] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ data: Record<string, unknown> }>(
        sql`select data from platform.audit_events where target_id = ${created.id} order by seq desc limit 1`,
      ),
    );
    expect(raw?.data).toMatchObject({
      impersonatedBy: `staff:${staffUserId}`,
      impersonationId: ctx.impersonatedBy?.impersonationId,
    });
    // The owner's own commands carry no impersonator.
    const own = await executeCommand(
      events.createEventCommand,
      {
        name: `By owner ${tag}`,
        timezone: 'UTC',
        startsAt: '2028-07-02T18:00:00Z',
        endsAt: '2028-07-02T20:00:00Z',
      },
      a.ctx(),
      ports,
    );
    const [mine] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ data: Record<string, unknown> }>(
        sql`select data from platform.audit_events where target_id = ${own.id} order by seq desc limit 1`,
      ),
    );
    expect(mine?.data).not.toHaveProperty('impersonatedBy');
  });
});

describe('impersonation: start and end in the org’s record, and the owners’ notice (M1.2e, D14)', () => {
  const staffCtx = (o: OrgFixture): Ctx =>
    createCtx({ orgId: o.org.id, actor: { type: 'system', name: `staff:${staffUserId}` } });

  it('start and end are audited in the org with the staff member as actor; only platform actors may', async () => {
    const impersonationId = uuidv7();
    const expiresAt = new Date(Date.now() + 3_600_000);
    const out = await executeCommand(
      startImpersonationCommand,
      {
        impersonationId,
        userId: a.viewerId,
        reason: 'Ticket 99: seating help',
        expiresAt,
        memberName: 'Vic Viewer',
      },
      staffCtx(a),
      ports,
    );
    expect(out).toEqual({ impersonationId, userId: a.viewerId, role: 'viewer' });
    await executeCommand(
      endImpersonationCommand,
      { impersonationId, userId: a.viewerId, how: 'ended' },
      staffCtx(a),
      ports,
    );
    const log = await executeQuery(
      auditLogQuery,
      { filter: { actor: `system:staff:${staffUserId}` } },
      a.ctx(),
      ports,
    );
    expect(log.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['impersonation.start', 'impersonation.end']),
    );
    // The free-text reason stays out of the org-facing view (allowlist); the end says how.
    const end = log.entries.find((e) => e.action === 'impersonation.end');
    expect(end?.details).toMatchObject({ reason: 'ended' });

    // A member (even an owner) or an API client can't write these.
    await expect(
      executeCommand(
        startImpersonationCommand,
        { impersonationId: uuidv7(), userId: a.viewerId, reason: 'x', expiresAt, memberName: '' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses someone who is not a member of that org (tenant isolation)', async () => {
    await expect(
      executeCommand(
        startImpersonationCommand,
        { impersonationId: uuidv7(), userId: b.ownerId, reason: 'x', expiresAt: new Date(), memberName: '' },
        staffCtx(a),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('tells the org’s owners at once, with the reason and when it ends', async () => {
    const impersonationId = uuidv7();
    const expiresAt = new Date(Date.now() + 3_600_000);
    await executeCommand(
      startImpersonationCommand,
      { impersonationId, userId: a.viewerId, reason: 'Ticket 100', expiresAt, memberName: 'Vic Viewer' },
      staffCtx(a),
      ports,
    );
    const [ev] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string; payload: Record<string, unknown> }>(
        sql`select id, payload from platform.domain_events where aggregate_id = ${impersonationId}`,
      ),
    );
    expect(ev).toBeTruthy();
    const memory = memoryNotifier();
    await consumeEvent(impersonationNotice({ notifier: memory.notifier, appOrigin: 'https://app.test' }), {
      id: uuidv7(),
      orgId: a.org.id,
      type: 'tenancy.impersonation_started',
      version: 1,
      aggregateType: 'impersonation',
      aggregateId: impersonationId,
      payload: ev?.payload ?? {},
      logSeq: 0,
    });
    expect(memory.members).toEqual([
      expect.objectContaining({
        kind: 'tenancy.staff-access',
        href: '/activity',
        params: expect.objectContaining({
          member: 'Vic Viewer',
          reason: 'Ticket 100',
          until: expiresAt.toISOString(),
          url: `https://app.test/o/${a.org.slug}/activity`,
        }),
      }),
    ]);
  });
});

describe('team: role changes and removals keep an owner in charge (M1.2c leftover)', () => {
  it('only an owner may make an owner, or change or remove one; the last owner stays', async () => {
    const adminId = uuidv7();
    const secondOwner = uuidv7();
    await executeCommand(addMemberCommand, { userId: adminId, role: 'admin' }, a.ctx(), ports);
    const asAdmin = userCtx(adminId, a.org.id);
    await expect(
      executeCommand(changeMemberRoleCommand, { userId: adminId, role: 'owner' }, asAdmin, ports),
    ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'owner_only' } });
    await expect(
      executeCommand(changeMemberRoleCommand, { userId: a.ownerId, role: 'viewer' }, asAdmin, ports),
    ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'owner_only' } });
    await expect(
      executeCommand(removeMemberCommand, { userId: a.ownerId }, asAdmin, ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      executeCommand(addMemberCommand, { userId: secondOwner, role: 'owner' }, asAdmin, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // An admin may manage everyone else.
    await expect(
      executeCommand(changeMemberRoleCommand, { userId: a.viewerId, role: 'manager' }, asAdmin, ports),
    ).resolves.toMatchObject({ role: 'manager' });
    await executeCommand(changeMemberRoleCommand, { userId: a.viewerId, role: 'viewer' }, asAdmin, ports);

    // The owner is the last owner: can't step down or leave.
    await expect(
      executeCommand(changeMemberRoleCommand, { userId: a.ownerId, role: 'admin' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'last_owner' } });
    await expect(
      executeCommand(removeMemberCommand, { userId: a.ownerId }, a.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'last_owner' },
    });
    // With a second owner, an owner may hand over.
    await executeCommand(changeMemberRoleCommand, { userId: adminId, role: 'owner' }, a.ctx(), ports);
    await executeCommand(changeMemberRoleCommand, { userId: adminId, role: 'admin' }, a.ctx(), ports);
    await executeCommand(removeMemberCommand, { userId: adminId }, a.ctx(), ports);
  });
});
