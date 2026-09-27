import {
  attendeeImportBulk,
  attendeeLabelBulk,
  stageImportCommand,
  validateImportCommand,
} from '@yayatoh/attendees';
import { setEntitlementOverrideCommand, setFeeOverrideCommand } from '@yayatoh/billing';
import { createCheckpointCommand, enrollDeviceCommand, scanTicketCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import {
  assignEventRoleCommand,
  createEventCommand,
  type EventDto,
  transitionEventCommand,
} from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import { publishFormCommand } from '@yayatoh/forms';
import { type Ctx, createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import {
  applyDisputeEventCommand,
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import { recordPayoutAccountCommand, releaseDueSettlementsCommand } from '@yayatoh/payments';
import { consumeEvent, defineSubscriber } from '@yayatoh/platform';
import { attendeeExportBulk } from '@yayatoh/reports';
import {
  assignSeatsCommand,
  holdSeatsTx,
  publishEventLayoutCommand,
  saveLayoutCommand,
  setEventLayoutCommand,
} from '@yayatoh/seating';
import {
  AGREEMENT_DOCUMENTS,
  acceptAgreementCommand,
  addMemberCommand,
  createOrganization,
  inviteMemberCommand,
  type OrganizationDto,
  PLATFORM_AGREEMENTS,
  setLegalPageCommand,
  setSuspensionCommand,
  updateOrganizationCommand,
} from '@yayatoh/tenancy';
import {
  createClaimLinksCommand,
  createPromoCodeCommand,
  createTicketTypeCommand,
  requestHolderLinkCommand,
} from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { ports, runBulk } from './ports.ts';

export interface OrgFixture {
  readonly org: OrganizationDto;
  readonly ownerId: string;
  readonly viewerId: string;
  readonly event: EventDto;
  /** Context of the owner inside this org. */
  readonly ctx: (overrides?: Partial<Ctx>) => Ctx;
}

export const userCtx = (userId: string, orgId: string | null = null, extra: Partial<Ctx> = {}): Ctx =>
  createCtx({ orgId, actor: { type: 'user', userId }, ...extra });

export const systemCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'fixture' } });

/**
 * One org with an owner and a viewer, and at least one row in every tenant table the kernel
 * owns. Every new tenant table must be populated here (the isolation suite checks it).
 */
export async function createOrgFixture(slug: string, name: string): Promise<OrgFixture> {
  const ownerId = uuidv7();
  const viewerId = uuidv7();
  const org = await createOrganization(userCtx(ownerId), { slug, name, defaultProfile: 'gala' }, ports);
  const ctx = (overrides: Partial<Ctx> = {}) => userCtx(ownerId, org.id, overrides);

  // Click-wrap: the owner accepts the platform's current terms (publishing needs them), and the
  // org has a legal page (isolation coverage).
  for (const document of AGREEMENT_DOCUMENTS)
    await executeCommand(
      acceptAgreementCommand,
      { document, version: PLATFORM_AGREEMENTS[document].version },
      ctx(),
      ports,
    );
  await executeCommand(
    setLegalPageCommand,
    { kind: 'refund', body: `Refunds for ${name}: none.` },
    ctx(),
    ports,
  );
  await executeCommand(addMemberCommand, { userId: viewerId, role: 'viewer' }, ctx(), ports);
  await executeCommand(
    updateOrganizationCommand,
    { timezone: 'America/Chicago' },
    ctx({ idempotencyKey: `fixture-${slug}` }),
    ports,
  );
  await executeCommand(
    inviteMemberCommand,
    { email: `invitee+${slug}@example.test`, role: 'manager' },
    ctx(),
    ports,
  );
  await executeCommand(
    setEntitlementOverrideCommand,
    { moduleKey: 'ai', effect: 'grant', reason: 'fixture' },
    systemCtx(org.id),
    ports,
  );
  await withTenant(systemCtx(org.id), (tx) =>
    tx.execute(sql`insert into billing.org_plans (org_id, plan_key) values (${org.id}, 'launch_standard')`),
  );
  // processed_events + idempotency_keys: consume the creation event once, store one key.
  const [evt] = await withTenant(systemCtx(org.id), (tx) =>
    tx.execute<{ id: string }>(sql`select id from platform.domain_events order by id limit 1`),
  );
  if (evt) {
    await consumeEvent(defineSubscriber({ name: 'fixture.noop', events: [], handle: async () => {} }), {
      id: evt.id,
      orgId: org.id,
      type: 'organization.created',
      version: 1,
      aggregateType: 'organization',
      aggregateId: org.id,
      payload: {},
      logSeq: 0,
    });
  }
  await withTenant(systemCtx(org.id), (tx) =>
    tx.execute(
      sql`insert into platform.idempotency_keys (org_id, scope, key, fingerprint, response) values (${org.id}, 'fixture', ${slug}, 'f', '{}')`,
    ),
  );
  const event = await executeCommand(
    createEventCommand,
    {
      name: `${name} Launch`,
      slug: `${slug}-launch`,
      timezone: 'America/Chicago',
      startsAt: '2027-10-14T14:00:00Z',
      endsAt: '2027-10-14T22:00:00Z',
    },
    ctx(),
    ports,
  );
  const ga = await executeCommand(
    createTicketTypeCommand,
    { eventId: event.id, name: 'General Admission', priceMinor: 2500, quantityTotal: 100 },
    ctx(),
    ports,
  );
  await executeCommand(
    createPromoCodeCommand,
    { eventId: event.id, code: 'FIXTURE10', kind: 'percent', percentBps: 1000 },
    ctx(),
    ports,
  );
  // Checkout questions (one sensitive) so forms, versions and responses are covered.
  await executeCommand(
    publishFormCommand,
    {
      kind: 'checkout_questions',
      subjectType: 'event',
      subjectId: event.id,
      definition: {
        fields: [
          { key: 'kids', type: 'count', label: 'Kids' },
          { key: 'access_needs', type: 'short_text', label: 'Access needs', sensitive: true },
        ],
      },
    },
    ctx(),
    ports,
  );
  // One paid order (fake provider) so orders, order items and provider events are covered.
  await executeCommand(transitionEventCommand, { eventId: event.id, transition: 'publish' }, ctx(), ports);
  const checkout = await executeCommand(
    startCheckoutCommand,
    {
      eventId: event.id,
      items: [{ ticketTypeId: ga.id, quantity: 2 }],
      buyer: { email: `buyer@${slug}.test`, name: 'Fixture Buyer' },
      marketingOptIn: true,
      answers: { kids: 1, access_needs: 'Step-free entrance' },
    },
    createCtx({ orgId: org.id }),
    ports,
  );
  await executeCommand(
    attachPaymentCommand,
    { orderId: checkout.order.id, provider: 'fake', providerPaymentId: `fakepi_${slug}` },
    createCtx({ orgId: org.id }),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_${slug}`,
      type: 'payment.succeeded',
      providerPaymentId: `fakepi_${slug}`,
      amountMinor: checkout.order.totalMinor,
      currency: checkout.order.currency,
      orgId: org.id,
      orderId: checkout.order.id,
    },
    systemCtx(org.id),
    ports,
  );
  // A dispute on the paid order, opened (hold) and won (hold undone): isolation coverage.
  for (const [type, outcome] of [
    ['dispute.created', undefined],
    ['dispute.closed', 'won'],
  ] as const)
    await executeCommand(
      applyDisputeEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_dp_${type}_${slug}`,
        type,
        orgId: org.id,
        providerPaymentId: `fakepi_${slug}`,
        providerDisputeId: `fakedp_${slug}`,
        amountMinor: checkout.order.totalMinor,
        currency: checkout.order.currency,
        reason: 'fraudulent',
        ...(outcome ? { outcome } : {}),
      },
      systemCtx(org.id),
      ports,
    );
  // The release job after the event (a settlement waiting for a payout account; isolation).
  await executeCommand(
    releaseDueSettlementsCommand,
    {},
    { ...systemCtx(org.id), now: new Date('2030-01-01T00:00:00Z') },
    ports,
  );
  // A refund the provider declined (isolation coverage; the order stays paid).
  const declined = await executeCommand(
    startRefundCommand,
    { orderId: checkout.order.id, reason: 'goodwill', amountMinor: 1 },
    ctx(),
    ports,
  );
  await executeCommand(
    completeRefundCommand,
    {
      refundId: declined.refundId,
      outcome: 'failed',
      providerRefundId: `fakere_${slug}`,
      failureCode: 'fixture',
    },
    ctx(),
    ports,
  );
  await executeCommand(enrollDeviceCommand, { label: `Door ${slug}` }, ctx(), ports);
  // One admission (and its scan) at event time, so the check-in tables are covered.
  const [issued] = await withTenant(systemCtx(org.id), (tx) =>
    tx.execute<{ short_code: string }>(sql`select short_code from ticketing.tickets order by serial limit 1`),
  );
  // Two entrances: admitted at one, shown at the other a minute later → a `two_entrances` signal.
  const gate = async (name: string) =>
    (
      await executeCommand(
        createCheckpointCommand,
        { eventId: event.id, name, kind: 'entrance' },
        ctx(),
        ports,
      )
    ).id;
  const mainGate = await gate('Main gate');
  const sideGate = await gate('Side gate');
  for (const [checkpointId, at] of [
    [mainGate, '2027-10-14T15:00:00Z'],
    [sideGate, '2027-10-14T15:01:00Z'],
  ] as const) {
    await executeCommand(
      scanTicketCommand,
      { eventId: event.id, code: issued?.short_code ?? '', checkpointId },
      ctx({ now: new Date(at) }),
      ports,
    );
  }
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'EUR', percentBps: 100, fixedMinor: 0, reason: 'fixture' },
    systemCtx(org.id),
    ports,
  );
  await executeCommand(
    assignEventRoleCommand,
    { eventId: event.id, userId: viewerId, role: 'door_staff' },
    ctx(),
    ports,
  );
  // Distribution: an open claim link, and a holder magic link (isolation coverage).
  const [held] = await withTenant(systemCtx(org.id), (tx) =>
    tx.execute<{ id: string; holder_email: string }>(
      sql`select id, holder_email from ticketing.tickets where event_id = ${event.id} order by serial limit 1`,
    ),
  );
  if (held) {
    await executeCommand(createClaimLinksCommand, { eventId: event.id, ticketIds: [held.id] }, ctx(), ports);
    await executeCommand(
      requestHolderLinkCommand,
      { eventId: event.id, email: held.holder_email },
      createCtx({ orgId: org.id }),
      ports,
    );
  }
  // A guest-list import (staged rows + a batch), a finished bulk label (undo data) and an export
  // (a file with parts), for isolation coverage.
  const staged = await executeCommand(
    stageImportCommand,
    {
      eventId: event.id,
      fileName: 'guests.csv',
      csv: `Name,Email\nImported ${slug},imported-${slug}@example.test\nNo Email,\n`,
    },
    ctx(),
    ports,
  );
  await executeCommand(
    validateImportCommand,
    { eventId: event.id, batchId: staged.batchId, mapping: { name: 0, email: 1 } },
    ctx(),
    ports,
  );
  for (const op of [
    await executeCommand(
      attendeeImportBulk.start,
      { eventId: event.id, selection: { filter: { batchId: staged.batchId } }, params: {} },
      ctx(),
      ports,
    ),
    await executeCommand(
      attendeeLabelBulk.start,
      { eventId: event.id, selection: { filter: {} }, params: { add: ['Fixture'] } },
      ctx(),
      ports,
    ),
    await executeCommand(
      attendeeExportBulk.start,
      { eventId: event.id, selection: { filter: {} }, params: EXPORT_PARAMS },
      ctx(),
      ports,
    ),
  ])
    await runBulk(org.id, op.operationId);
  // A payout account still in onboarding (orders stay platform_mor), for isolation coverage.
  await executeCommand(
    recordPayoutAccountCommand,
    { provider: 'fake', accountId: `fakeacct_${slug}`, country: 'US' },
    ctx(),
    ports,
  );
  // A lifted staff pause (kill-switch history), for isolation coverage without pausing anything.
  for (const paused of [true, false])
    await executeCommand(
      setSuspensionCommand,
      { kind: 'pause_messaging', paused, reason: 'fixture' },
      systemCtx(org.id),
      ports,
    );
  // Seating: a floor plan, the event's copy of it, and one held seat (isolation coverage).
  const plan = {
    version: 1,
    width: 2000,
    height: 1000,
    sections: [],
    items: [buildRow({ label: 'A', count: 4, x: 100, y: 100 })],
  };
  const layout = await executeCommand(saveLayoutCommand, { name: 'Main room', doc: plan }, ctx(), ports);
  await executeCommand(setEventLayoutCommand, { eventId: event.id, layoutId: layout.id }, ctx(), ports);
  await executeCommand(publishEventLayoutCommand, { eventId: event.id }, ctx(), ports);
  await withTenant(ctx(), (tx) =>
    holdSeatsTx(tx, ctx(), {
      eventId: event.id,
      seatUuids: [plan.items[0]?.seats[0]?.id ?? ''],
      holdId: uuidv7(),
      expiresAt: new Date(Date.now() + 600_000),
    }),
  );
  // A guest seated at that row (M1.7d seat assignments, isolation coverage).
  const [guest] = await withTenant(ctx(), (tx) =>
    tx.execute<{ id: string }>(
      sql`select id from attendees.attendees where event_id = ${event.id} and ticket_id is null and status = 'active' order by created_at limit 1`,
    ),
  );
  if (!guest) throw new Error('fixture: no guest to seat');
  await executeCommand(
    assignSeatsCommand,
    { eventId: event.id, attendeeIds: [guest.id], itemId: plan.items[0]?.id ?? '' },
    ctx(),
    ports,
  );
  return { org, ownerId, viewerId, event, ctx };
}

/** English headers for attendee exports (the console passes its own locale's). */
export const EXPORT_PARAMS = {
  headers: {
    name: 'Name',
    email: 'Email',
    ticketType: 'Ticket type',
    ticketCode: 'Ticket code',
    serial: 'No.',
    source: 'Source',
    status: 'Status',
    labels: 'Labels',
    registeredAt: 'Registered',
    checkedIn: 'Checked in',
  },
  yes: 'Yes',
  no: 'No',
};

/** The two-org adversarial fixture (roadmap §9 seeds: `two-org-adversarial`). */
export async function twoOrgs(suffix = uuidv7().slice(-8)) {
  const a = await createOrgFixture(`alpha-${suffix}`, 'Alpha Events');
  const b = await createOrgFixture(`bravo-${suffix}`, 'Bravo Weddings');
  return { a, b };
}
