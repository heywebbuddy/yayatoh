import { setEntitlementOverrideCommand, setFeeOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import {
  assignEventRoleCommand,
  createEventCommand,
  type EventDto,
  transitionEventCommand,
} from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import { applyProviderEventCommand, attachPaymentCommand, startCheckoutCommand } from '@yayatoh/orders';
import { consumeEvent, defineSubscriber } from '@yayatoh/platform';
import {
  addMemberCommand,
  createOrganization,
  inviteMemberCommand,
  type OrganizationDto,
  updateOrganizationCommand,
} from '@yayatoh/tenancy';
import { createPromoCodeCommand, createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { ports } from './ports.ts';

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
  // One paid order (fake provider) so orders, order items and provider events are covered.
  await executeCommand(transitionEventCommand, { eventId: event.id, transition: 'publish' }, ctx(), ports);
  const checkout = await executeCommand(
    startCheckoutCommand,
    {
      eventId: event.id,
      items: [{ ticketTypeId: ga.id, quantity: 2 }],
      buyer: { email: `buyer@${slug}.test`, name: 'Fixture Buyer' },
      marketingOptIn: true,
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
  return { org, ownerId, viewerId, event, ctx };
}

/** The two-org adversarial fixture (roadmap §9 seeds: `two-org-adversarial`). */
export async function twoOrgs(suffix = uuidv7().slice(-8)) {
  const a = await createOrgFixture(`alpha-${suffix}`, 'Alpha Events');
  const b = await createOrgFixture(`bravo-${suffix}`, 'Bravo Weddings');
  return { a, b };
}
