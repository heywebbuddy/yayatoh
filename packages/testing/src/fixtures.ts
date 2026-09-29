import { createECDH } from 'node:crypto';
import { draftEventCopy, fakeDrafter } from '@yayatoh/ai';
import {
  attendeeImportBulk,
  attendeeLabelBulk,
  stageImportCommand,
  validateImportCommand,
} from '@yayatoh/attendees';
import { catchUpParticipation, saveSegmentCommand, templateDefinition } from '@yayatoh/audiences';
import { setEntitlementOverrideCommand, setFeeOverrideCommand } from '@yayatoh/billing';
import {
  createCampaignCommand,
  runOrgCampaigns,
  saveCampaignCommand,
  sendNowCommand,
  setAudienceCommand,
} from '@yayatoh/campaigns';
import {
  chatReportSignals,
  createCheckpointCommand,
  enrollDeviceCommand,
  scanTicketCommand,
  setDetectionSettingsCommand,
} from '@yayatoh/checkin';
import { createEntryCommand, setEntryStatusCommand } from '@yayatoh/cms';
import { withTenant } from '@yayatoh/db';
import {
  addRecurringOccurrencesCommand,
  addSectionCommand,
  assignEventRoleCommand,
  cancelOccurrenceCommand,
  createAccessCodeCommand,
  createAnnouncementCommand,
  createEventCommand,
  createSeriesCommand,
  type EventDto,
  listOccurrencesQuery,
  redeemAccessCodeCommand,
  setEventDetailsCommand,
  setEventSeriesCommand,
  setPrivateInfoCommand,
  transitionEventCommand,
} from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import { publishFormCommand } from '@yayatoh/forms';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  attributeOrderCommand,
  createTrackedLinkCommand,
  recordClickCommand,
  setAttributionWindowCommand,
} from '@yayatoh/marketing';
import { addLegacyRedirectCommand, catchUpListings, updateSiteSettingsCommand } from '@yayatoh/marketplace';
import { uploadLogo, uploadMedia, uploadProgramImage } from '@yayatoh/media';
import {
  announcementMailer,
  contactMessageCommand,
  contactReportCommand,
  reportThreadCommand,
  sendAnnouncementCommand,
  threadToken,
} from '@yayatoh/messaging';
import {
  createNotifier,
  dispatchDue,
  memoryTransports,
  recordDeliveryEventsCommand,
  registerPushTokenCommand,
  sendTestNotificationCommand,
  setFrequencyCapsCommand,
  setMyPreferencesCommand,
  setQuotaLimitCommand,
  setTemplateOverrideCommand,
  storeEmailPreviewCommand,
  unsubscribeCommand,
  unsubscribeUrls,
} from '@yayatoh/notifications';
import {
  addOrderNoteCommand,
  applyDisputeEventCommand,
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  declineRefundRequestCommand,
  refundRequestsQuery,
  registerOrderPushCommand,
  requestRefundCommand,
  setCheckoutSettingsCommand,
  setRefundPolicyCommand,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import {
  recordPayoutAccountCommand,
  recordReconciliationCommand,
  releaseDueSettlementsCommand,
} from '@yayatoh/payments';
import {
  ALERTS_CHANNEL,
  catchUpSubscriber,
  consumeEvent,
  defineSubscriber,
  publishRealtimeTx,
  recentEventsTx,
} from '@yayatoh/platform';
import { dsarExportBulk } from '@yayatoh/privacy';
import {
  createExhibitorCommand,
  createRoomCommand,
  createSessionCommand,
  createSpeakerCommand,
  createSponsorCommand,
  createSponsorTierCommand,
  createTrackCommand,
} from '@yayatoh/program';
import {
  analyticsForwarder,
  attendeeExportBulk,
  catchUpMetrics,
  postgresAnalyticsSink,
} from '@yayatoh/reports';
import { reportReviewCommand, submitReviewCommand } from '@yayatoh/reviews';
import {
  assignSeatsCommand,
  holdSeatsTx,
  publishEventLayoutCommand,
  requestFinderCodeCommand,
  saveLayoutCommand,
  setEventLayoutCommand,
  setFinderSettingsCommand,
  setSeatingRulesCommand,
} from '@yayatoh/seating';
import {
  createSurveyCommand,
  sendSurveyCommand,
  submitSurveyResponseCommand,
  surveyToken,
} from '@yayatoh/surveys';
import { saveTemplateCommand } from '@yayatoh/templates';
import {
  AGREEMENT_DOCUMENTS,
  API_KEY_SCOPES,
  acceptAgreementCommand,
  addMemberCommand,
  createApiKeyCommand,
  createOrganization,
  inviteMemberCommand,
  type OrganizationDto,
  PLATFORM_AGREEMENTS,
  revokeApiKeyCommand,
  setLegalPageCommand,
  setOrgStatusCommand,
  setSuspensionCommand,
  updateOrganizationCommand,
} from '@yayatoh/tenancy';
import {
  createClaimLinksCommand,
  createPromoCodeCommand,
  createTicketTypeCommand,
  requestHolderLinkCommand,
} from '@yayatoh/ticketing';
import { createVenueCommand, submitQuoteRequestCommand } from '@yayatoh/venues';
import { sql } from 'drizzle-orm';
import { ports, runBulk } from './ports.ts';

export interface OrgFixture {
  readonly org: OrganizationDto;
  readonly ownerId: string;
  readonly viewerId: string;
  readonly event: EventDto;
  /** A live org API key with every scope (the /v1 tests' credential). */
  readonly apiKey: string;
  /** A `yy_test_` key (read-only, `org:read` + `events:read`). */
  readonly testKey: string;
  /** Context of the owner inside this org. */
  readonly ctx: (overrides?: Partial<Ctx>) => Ctx;
}

/**
 * A signed-in user's context. Like a real session it counts as freshly stepped up (signing in is
 * a re-authentication, M1.2c) unless `stepUpAt` is given: pass `stepUpAt: null` or an old date to
 * act as a user whose fresh window has passed.
 */
export const userCtx = (userId: string, orgId: string | null = null, extra: Partial<Ctx> = {}): Ctx =>
  createCtx({
    orgId,
    actor: { type: 'user', userId },
    ...extra,
    stepUpAt: 'stepUpAt' in extra ? (extra.stepUpAt ?? null) : (extra.now ?? new Date()),
  });

/** A user context whose step-up window has passed (11 minutes since the last re-authentication). */
export const staleCtx = (ctx: Ctx): Ctx => ({ ...ctx, stepUpAt: new Date(ctx.now.getTime() - 11 * 60_000) });

export const systemCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'fixture' } });

/** Small PNGs for the fixture's media rows (a cover and a logo). */
const FIXTURE_PNG = {
  cover:
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwC18lOpr1QH2PPOFgAET03KV/drCuIgtChmqHYMtbxE8GIDtUMxZaxDqH4oKFDNUOxZcghBGOdjhwe1wfNjF55zyzI+QAAAABJRU5ErkJggg==',
  logo: 'iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe3YwQkAMAxC0c7iTi7plN2hl14e5B6QxI+epV/mWBxSz3HVO4WBjGUWJAKLhcXA4mCxsBhYHCxKixXMo4qY8qXPGlzD8A6qpKqyHgAAAABJRU5ErkJggg==',
} as const;
const fixturePng = (k: keyof typeof FIXTURE_PNG) => new Uint8Array(Buffer.from(FIXTURE_PNG[k], 'base64'));

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
  // realtime_messages (M3.1b): one logged message on the org's alerts channel.
  await withTenant(systemCtx(org.id), (tx) =>
    publishRealtimeTx(tx, org.id, ALERTS_CHANNEL, {
      event: 'alert',
      data: {
        alertId: uuidv7(),
        eventId: null,
        state: 'open',
        severity: 'info',
        at: new Date().toISOString(),
      },
    }),
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
  // M3.8a: a tracked link and one click on it from the buyer's device, before the order.
  const link = await executeCommand(
    createTrackedLinkCommand,
    { eventId: event.id, source: 'newsletter', medium: 'email', campaign: `fixture-${slug}` },
    ctx(),
    ports,
  );
  const buyerDevice = `fixture-device-${slug}`.padEnd(16, 'x');
  await executeCommand(
    recordClickCommand,
    { linkId: link.id, deviceId: buyerDevice, ip: '203.0.113.7' },
    createCtx({ orgId: org.id }),
    ports,
  );
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
  // M3.8a: the order's attribution record (first and last touch: the click above) and settings.
  await executeCommand(
    attributeOrderCommand,
    { orderId: checkout.order.id, deviceId: buyerDevice },
    createCtx({ orgId: org.id }),
    ports,
  );
  await executeCommand(setAttributionWindowCommand, { windowDays: 30 }, ctx(), ports);
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
  // M1.5f: the event's checkout settings (buyer email verification off, not the default).
  await executeCommand(setCheckoutSettingsCommand, { eventId: event.id, verifyEmail: false }, ctx(), ports);
  // M3.10a: a waitlist on the pass with one person waiting (isolation coverage; inserted directly
  // so the pass stays on sale for the tests that buy it).
  await withTenant(systemCtx(org.id), async (tx) => {
    const [list] = await tx.execute<{ id: string }>(sql`
      insert into orders.waitlists (org_id, event_id, ticket_type_id, updated_by)
      values (${org.id}, ${event.id}, ${ga.id}, 'fixture') returning id`);
    await tx.execute(sql`
      insert into orders.waitlist_entries (org_id, waitlist_id, event_id, ticket_type_id, name, email, quantity, position_at, status, ended_at)
      values (${org.id}, ${list?.id}, ${event.id}, ${ga.id}, 'Fixture Waiter', ${`waiter@${slug}.test`}, 2, now(), 'left', now())`);
  });
  // M1.6e: a refund policy on the event, and a reconciliation day with one open difference.
  await executeCommand(
    setRefundPolicyCommand,
    { eventId: event.id, kind: 'until', daysBefore: 7, retainedMinor: 100 },
    ctx(),
    ports,
  );
  // M3.10b: the buyer asked for a refund (declined with a reason) and asked again (open), a note
  // on the order, and a finished mass refund with one skipped order (isolation coverage).
  const buyerCtx = createCtx({ orgId: org.id });
  await executeCommand(
    requestRefundCommand,
    { manageToken: checkout.manageToken, message: 'I cannot attend any more.' },
    buyerCtx,
    ports,
  );
  const [firstRequest] = await executeQuery(refundRequestsQuery, {}, ctx(), ports);
  if (!firstRequest) throw new Error('fixture: no refund request');
  await executeCommand(
    declineRefundRequestCommand,
    { requestId: firstRequest.id, reason: 'The refund window is not open for this.' },
    ctx(),
    ports,
  );
  await executeCommand(
    requestRefundCommand,
    { manageToken: checkout.manageToken, message: 'Asking once more, please.' },
    buyerCtx,
    ports,
  );
  await executeCommand(
    addOrderNoteCommand,
    { orderId: checkout.order.id, body: 'Called the buyer about their request.' },
    ctx(),
    ports,
  );
  await withTenant(systemCtx(org.id), (tx) =>
    tx.execute(sql`
      with run as (
        insert into orders.mass_refunds
          (org_id, event_id, reason, status, currency, total, processed, skipped, requested_by, finished_at)
        values (${org.id}, ${event.id}, 'event_cancelled', 'done', 'USD', 1, 1, 1, 'system:fixture', now())
        returning id)
      insert into orders.mass_refund_items (org_id, run_id, order_id, position, status, code)
      select ${org.id}, run.id, ${checkout.order.id}, 0, 'skipped', 'fixture' from run`),
  );
  await executeCommand(
    recordReconciliationCommand,
    {
      day: '2030-01-01',
      provider: 'fake',
      transactions: [
        {
          id: `fakebt_${slug}`,
          kind: 'charge',
          amountMinor: 999,
          currency: 'USD',
          occurredAt: new Date('2030-01-01T12:00:00Z'),
          reference: `order:${checkout.order.id}`,
        },
      ],
    },
    systemCtx(org.id),
    ports,
  );
  await executeCommand(enrollDeviceCommand, { label: `Door ${slug}` }, ctx(), ports);
  // Org API keys: one live with every scope, one test key (M1.13d), one revoked (isolation coverage).
  const { key: apiKey } = await executeCommand(
    createApiKeyCommand,
    { name: `Fixture ${slug}`, scopes: [...API_KEY_SCOPES] },
    ctx(),
    ports,
  );
  const { key: testKey } = await executeCommand(
    createApiKeyCommand,
    { name: `Sandbox ${slug}`, scopes: ['org:read', 'events:read'], mode: 'test' },
    ctx(),
    ports,
  );
  const retired = await executeCommand(
    createApiKeyCommand,
    { name: `Retired ${slug}`, scopes: ['events:read'] },
    ctx(),
    ports,
  );
  await executeCommand(revokeApiKeyCommand, { apiKeyId: retired.id }, ctx(), ports);
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
  // Per-event velocity rule settings (M1.9d), for isolation coverage.
  await executeCommand(
    setDetectionSettingsCommand,
    { eventId: event.id, maxScansPerMinute: 60, maxTravelKmh: 15 },
    ctx(),
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
  // Org status history (M1.3f): suspended and reactivated at once (isolation coverage).
  for (const action of ['suspend', 'reactivate'] as const)
    await executeCommand(setOrgStatusCommand, { action, reason: 'fixture' }, systemCtx(org.id), ports);
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
    tx.execute<{ id: string; email: string }>(
      sql`select id, email from attendees.attendees where event_id = ${event.id} and ticket_id is null and status = 'active' order by created_at limit 1`,
    ),
  );
  if (!guest) throw new Error('fixture: no guest to seat');
  await executeCommand(
    assignSeatsCommand,
    { eventId: event.id, attendeeIds: [guest.id], itemId: plan.items[0]?.id ?? '' },
    ctx(),
    ports,
  );
  // Seating rules (M1.7f): accessible seats kept back a week (a warning), isolation coverage.
  await executeCommand(
    setSeatingRulesCommand,
    {
      eventId: event.id,
      rules: [{ kind: 'ada_reserved', severity: 'warn', params: { releaseDays: 7 } }],
    },
    ctx(),
    ports,
  );
  // The public seat finder (M1.7e): opened, and that guest asks for a code (a code row and a
  // rate-limit counter, isolation coverage).
  await executeCommand(
    setFinderSettingsCommand,
    { eventId: event.id, publicMap: true, mode: 'code' },
    ctx(),
    ports,
  );
  await executeCommand(
    requestFinderCodeCommand,
    { eventId: event.id, email: guest.email, device: `fixture-${slug}` },
    createCtx({ orgId: org.id }),
    ports,
  );
  // Marketplace (M1.11): enrolled, the event's listing projected, one legacy redirect.
  await executeCommand(updateSiteSettingsCommand, { listOnMarketplace: true }, ctx(), ports);
  await catchUpListings(org.id);
  await executeCommand(
    addLegacyRedirectCommand,
    { host: 'yayatoh.com', source: `/${slug}`, target: `/o/${slug}` },
    systemCtx(org.id),
    ports,
  );
  // Notifications (M1.10): a queued and a sent message, an inbox item, a preference, a push
  // token, a template override and an unsubscribe (isolation coverage).
  const notifier = createNotifier();
  await withTenant(systemCtx(org.id), async (tx) => {
    await notifier.enqueue(tx, {
      kind: 'attendees.message',
      to: { email: `fan+${slug}@example.test`, timeZone: 'UTC' },
      params: { subject: 'Hello', body: 'Welcome', name: 'Fan', eventName: event.name },
      dedupeKey: `fixture:${slug}`,
      eventId: event.id,
    });
    await notifier.notifyMembers(tx, {
      kind: 'sales.order_paid',
      params: { name: 'Fixture', eventName: event.name, count: 1, amountMinor: 1000, currency: 'USD' },
      dedupeKey: `fixture-sale:${slug}`,
    });
  });
  await dispatchDue(org.id, {
    transports: memoryTransports().transports,
    appOrigin: 'https://app.yayatoh.test',
    ignoreQuietHours: true,
  });
  const [sentMessage] = await withTenant(systemCtx(org.id), (tx) =>
    tx.execute<{ id: string }>(
      sql`select id from notifications.messages where dedupe_key = ${`fixture:${slug}`} and status = 'sent'`,
    ),
  );
  if (!sentMessage) throw new Error('fixture: the notification was not sent');
  const unsubscribeToken =
    unsubscribeUrls('https://app.yayatoh.test', sentMessage.id).page.split('/').pop() ?? '';
  await executeCommand(
    unsubscribeCommand,
    { token: unsubscribeToken, source: 'page' },
    createCtx({ orgId: org.id }),
    ports,
  );
  // M1.10d: a delivery report (a hard bounce, so a suppressed address) and a stored preview.
  await executeCommand(
    recordDeliveryEventsCommand,
    {
      provider: 'fake',
      events: [
        {
          id: `fixture-bounce-${slug}`,
          type: 'bounced',
          bounceType: 'hard',
          messageId: sentMessage.id,
          providerMessageId: null,
          recipient: null,
          detail: '550 fixture',
          occurredAt: new Date(),
        },
      ],
    },
    systemCtx(org.id),
    ports,
  );
  await executeCommand(storeEmailPreviewCommand, { html: `<p>${name}</p>` }, ctx(), ports);
  await withTenant(systemCtx(org.id), (tx) =>
    notifier.enqueue(tx, {
      kind: 'attendees.message',
      to: { email: `later+${slug}@example.test` },
      params: { subject: 'Later', body: 'Soon', name: 'Later', eventName: event.name },
      dedupeKey: `fixture-later:${slug}`,
      sendAfter: new Date('2099-01-01T00:00:00Z'),
    }),
  );
  await executeCommand(
    setMyPreferencesCommand,
    { preferences: [{ category: 'sales', channel: 'email', enabled: true }] },
    ctx(),
    ports,
  );
  await executeCommand(
    registerPushTokenCommand,
    { platform: 'fcm', token: `fixture-token-${slug}` },
    ctx(),
    ports,
  );
  // M1.10e: a browser (web push) device, a test notification pushed to it, and its delivery log row.
  const browserKey = createECDH('prime256v1');
  browserKey.generateKeys();
  await executeCommand(
    registerPushTokenCommand,
    {
      platform: 'webpush',
      subscription: {
        endpoint: `https://fcm.googleapis.com/fcm/send/fixture-${slug}`,
        keys: {
          p256dh: browserKey.getPublicKey().toString('base64url'),
          auth: Buffer.alloc(16, 7).toString('base64url'),
        },
        label: 'Fixture browser',
      },
    },
    ctx(),
    ports,
  );
  await executeCommand(sendTestNotificationCommand, {}, ctx(), ports);
  // A guest buyer's browser, opted in from their order page (M1.10e: owned by the buyer's email).
  const guestKey = createECDH('prime256v1');
  guestKey.generateKeys();
  await executeCommand(
    registerOrderPushCommand,
    {
      token: checkout.manageToken,
      subscription: {
        endpoint: `https://fcm.googleapis.com/fcm/send/fixture-guest-${slug}`,
        keys: {
          p256dh: guestKey.getPublicKey().toString('base64url'),
          auth: Buffer.alloc(16, 9).toString('base64url'),
        },
        label: 'Fixture guest browser',
      },
    },
    createCtx({ orgId: org.id }),
    ports,
  );
  await dispatchDue(org.id, {
    transports: memoryTransports().transports,
    appOrigin: 'https://app.yayatoh.test',
  });
  await executeCommand(
    setTemplateOverrideCommand,
    { kind: 'orders.tickets', locale: 'en', subject: `Tickets from ${name}`, intro: null },
    ctx(),
    ports,
  );
  // Messaging policy (M3.5a): a staff quota limit, the org's own caps and a (lifted) auto-pause
  // record; the sends above already metered usage (isolation coverage).
  await executeCommand(
    setQuotaLimitCommand,
    { channel: 'sms', monthlyLimit: 250, reason: 'fixture limit' },
    systemCtx(org.id),
    ports,
  );
  await executeCommand(
    setFrequencyCapsCommand,
    { caps: [{ scope: 'marketing', maxMessages: 1, windowHours: 72 }] },
    ctx(),
    ports,
  );
  await withTenant(systemCtx(org.id), (tx) =>
    tx.execute(sql`insert into notifications.auto_pauses
      (org_id, complaints, sent, rate_bps, window_start, lifted_at, lifted_by, lift_note)
      values (${org.id}, 2, 400, 50, now() - interval '1 day', now(), 'system:fixture', 'fixture lift')`),
  );
  // Messaging (M1.10c): an announcement fanned out to the event's attendees, a contact's reply,
  // and a report from each side (isolation coverage).
  const sent = await executeCommand(
    sendAnnouncementCommand,
    { eventId: event.id, subject: 'Doors at 7', body: 'See you there.', channels: ['email'] },
    ctx({ idempotencyKey: `fixture-announcement-${slug}` }),
    ports,
  );
  const [announced] = await withTenant(systemCtx(org.id), (tx) =>
    recentEventsTx(tx, org.id, ['announcement.sent'], 3_600_000),
  );
  if (!announced || !sent.id) throw new Error('fixture: no announcement event');
  await consumeEvent(announcementMailer({ notifier, appOrigin: 'https://app.yayatoh.test' }), announced);
  const [thread] = await withTenant(systemCtx(org.id), (tx) =>
    tx.execute<{ id: string }>(sql`select id from messaging.threads order by created_at limit 1`),
  );
  if (!thread) throw new Error('fixture: no conversation');
  const anon = createCtx({ orgId: org.id });
  await executeCommand(
    contactMessageCommand,
    { token: threadToken(thread.id), body: 'Is there parking?' },
    anon,
    ports,
  );
  await executeCommand(contactReportCommand, { token: threadToken(thread.id), reason: 'other' }, anon, ports);
  await executeCommand(reportThreadCommand, { threadId: thread.id, reason: 'spam' }, ctx(), ports);
  // M1.9e: the organizer's report becomes a chat-sourced fraud signal (isolation coverage of the
  // one signal model's new columns); the contact's report raises none.
  for (const e of await withTenant(systemCtx(org.id), (tx) =>
    recentEventsTx(tx, org.id, ['messaging.report_filed'], 3_600_000),
  ))
    await consumeEvent(chatReportSignals(), e);
  // Surveys (M3.9a): a post-event survey sent the day after the event, and one answer through
  // its link (survey, send, invitations, response and form rows, isolation coverage).
  const surveyAt = new Date(event.endsAt.getTime() + 86_400_000);
  const survey = await executeCommand(
    createSurveyCommand,
    {
      eventId: event.id,
      kind: 'post_event',
      title: `How was ${name}?`,
      definition: {
        fields: [
          { key: 'nps', type: 'nps', label: 'Recommend us?', required: true },
          { key: 'note', type: 'long_text', label: 'Anything else?' },
        ],
      },
    },
    ctx({ now: surveyAt }),
    ports,
  );
  await executeCommand(
    sendSurveyCommand,
    { eventId: event.id, surveyId: survey.id, reminderDays: 3 },
    ctx({ now: surveyAt, idempotencyKey: `fixture-survey-${slug}` }),
    ports,
  );
  const [invitation] = await withTenant(systemCtx(org.id), (tx) =>
    tx.execute<{ id: string }>(
      sql`select id from surveys.invitations where survey_id = ${survey.id} order by created_at, id limit 1`,
    ),
  );
  if (!invitation) throw new Error('fixture: no survey invitation');
  await executeCommand(
    submitSurveyResponseCommand,
    { token: surveyToken(invitation.id), answers: { nps: 9, note: 'Lovely evening.' } },
    createCtx({ orgId: org.id, now: surveyAt }),
    ports,
  );
  // M1.4b: a weekly event with dates (one cancelled), a series holding both events, and a
  // template saved from the launch event (isolation coverage).
  const weekly = await executeCommand(
    createEventCommand,
    {
      name: `${name} Weekly`,
      slug: `${slug}-weekly`,
      timezone: 'America/Chicago',
      startsAt: '2027-11-04T00:00:00Z',
      endsAt: '2027-11-04T03:00:00Z',
    },
    ctx(),
    ports,
  );
  await executeCommand(
    addRecurringOccurrencesCommand,
    {
      eventId: weekly.id,
      rule: { startDate: '2027-11-03', startTime: '19:00', endTime: '22:00', freq: 'weekly', count: 3 },
    },
    ctx(),
    ports,
  );
  const [firstDate] = await executeQuery(listOccurrencesQuery, { eventId: weekly.id }, ctx(), ports);
  if (firstDate) await executeCommand(cancelOccurrenceCommand, { occurrenceId: firstDate.id }, ctx(), ports);
  const tour = await executeCommand(
    createSeriesCommand,
    { name: `${name} Tour`, slug: `${slug}-tour` },
    ctx(),
    ports,
  );
  for (const e of [event, weekly])
    await executeCommand(setEventSeriesCommand, { eventId: e.id, seriesId: tour.id }, ctx(), ports);
  await executeCommand(saveTemplateCommand, { eventId: event.id, name: `${name} template` }, ctx(), ports);
  // M1.4c: a directory venue picked for the event, a quote request on it, and tags.
  const venue = await executeCommand(
    createVenueCommand,
    { name: `${name} Hall`, country: 'US', timezone: 'America/Chicago', directoryListed: true },
    ctx(),
    ports,
  );
  await executeCommand(
    setEventDetailsCommand,
    { eventId: event.id, venueId: venue.id, category: 'community', tags: ['Fixture', 'Isolation'] },
    ctx(),
    ports,
  );
  await executeCommand(
    submitQuoteRequestCommand,
    {
      venueId: venue.id,
      name: 'Quote Asker',
      email: `quotes@${slug}.test`,
      message: 'Do you have space for 120 guests?',
      clientKey: `fixture-client-${slug}`,
    },
    createCtx({ orgId: org.id }),
    ports,
  );
  // M1.4d: a section, an announcement, private info, an access code (one use and one failed
  // attempt); the short link was created with the event.
  await executeCommand(
    addSectionCommand,
    { eventId: event.id, kind: 'text', title: 'About', content: { markdown: 'Welcome.' } },
    ctx(),
    ports,
  );
  await executeCommand(
    createAnnouncementCommand,
    { eventId: event.id, title: 'Doors at six', body: 'See you there.', publish: true },
    ctx(),
    ports,
  );
  await executeCommand(
    setPrivateInfoCommand,
    { eventId: event.id, body: `Wi-Fi password: fixture-${slug}` },
    ctx(),
    ports,
  );
  await executeCommand(
    createAccessCodeCommand,
    { eventId: event.id, code: 'FIXTURE-CODE', unlocksEvent: true },
    ctx(),
    ports,
  );
  for (const code of ['FIXTURE-CODE', 'WRONG-CODE'])
    await executeCommand(
      redeemAccessCodeCommand,
      { eventId: event.id, code, clientKey: `fixture-client-${slug}` },
      createCtx({ orgId: org.id }),
      ports,
    );
  // A data-subject access request for the imported guest (M1.14c, isolation coverage).
  const dsar = await executeCommand(
    dsarExportBulk.start,
    {
      selection: { filter: { email: `imported-${slug}@example.test` } },
      params: { email: `imported-${slug}@example.test`, orgName: name },
    },
    ctx(),
    ports,
  );
  await runBulk(org.id, dsar.operationId);
  // Legacy migration (M2.2b): a host_affiliate child org (its own owner) and one legacy statement.
  const affiliate = await createOrganization(
    userCtx(uuidv7()),
    { slug: `${slug}-affiliate`, name: `${name} Affiliate` },
    ports,
  );
  await withTenant(systemCtx(org.id), async (tx) => {
    await tx.execute(
      sql`insert into tenancy.org_relationships (org_id, child_org_id, kind, source) values (${org.id}, ${affiliate.id}, 'host_affiliate', 'fixture')`,
    );
    await tx.execute(sql`
      insert into payments.legacy_settlements (org_id, kind, instance, event_id, currency, status,
        customer_paid_minor, commission_minor, admin_tax_minor, organizer_earning_minor,
        transferred_minor, open_minor, source_rows)
      values (${org.id}, 'event_statement', 'yay', ${event.id}, 'USD', 'open', 10000, 1000, 0, 9000, 0, 9000, 4)`);
    // Legacy migration (M2.2c): the history projections (participation, contact totals, monthly metrics).
    await tx.execute(sql`
      with c as (
        insert into crm.contacts (org_id, email, email_norm, name, source)
        values (${org.id}, ${`history-${slug}@example.test`}, ${`history-${slug}@example.test`}, 'History Fixture', 'legacy')
        returning id
      ), p as (
        insert into crm.event_participation (org_id, contact_id, event_id, tickets, checked_in, registered_at, spend_minor, currency, source)
        select ${org.id}, id, ${event.id}, 2, true, now(), 5000, 'USD', 'legacy' from c
      )
      insert into crm.contact_stats (org_id, contact_id, currency, orders, tickets, events, events_attended, spend_minor,
                                     first_seen_at, last_seen_at, source)
      select ${org.id}, id, 'USD', 1, 2, 1, 1, 5000, now(), now(), 'legacy' from c`);
    await tx.execute(sql`
      insert into platform.metric_timeseries (org_id, metric, bucket, currency, value, source)
      values (${org.id}, 'sales.gross', '2025-01-01', 'USD', 5000, 'legacy')`);
  });
  // Media (M1.4e): an event cover and the org logo (assets, variants, blobs in the dev store),
  // and a quota override row.
  await uploadMedia(
    ctx(),
    { ownerType: 'event', ownerId: event.id, slot: 'cover', alt: `${name} cover`, file: fixturePng('cover') },
    ports,
  );
  await uploadLogo(ctx(), { alt: `${name} logo`, file: fixturePng('logo') }, ports);
  await withTenant(systemCtx(org.id), (tx) =>
    tx.execute(sql`insert into media.quotas (org_id, bytes_limit) values (${org.id}, ${512 * 1024 * 1024})`),
  );
  // M1.4f: a small program (track, room, speaker, session, exhibitor, sponsor tier and sponsor)
  // and one AI draft (credit account + ledger rows), for isolation coverage.
  const track = await executeCommand(
    createTrackCommand,
    { eventId: event.id, name: 'Main track' },
    ctx(),
    ports,
  );
  const room = await executeCommand(
    createRoomCommand,
    { eventId: event.id, name: 'Hall A', capacity: 200 },
    ctx(),
    ports,
  );
  const speaker = await executeCommand(
    createSpeakerCommand,
    { eventId: event.id, name: `${name} Speaker`, company: name, bio: 'Talks about *fixtures*.' },
    ctx(),
    ports,
  );
  // M1.4h: the speaker's photo (a media asset owned by a program row).
  await uploadProgramImage(
    ctx(),
    'speaker',
    { ownerId: speaker.id, alt: `Photo of ${name} Speaker`, file: fixturePng('logo') },
    ports,
  );
  await executeCommand(
    createSessionCommand,
    {
      eventId: event.id,
      title: 'Opening keynote',
      startsAt: event.startsAt,
      endsAt: new Date(event.startsAt.getTime() + 3_600_000),
      roomId: room.id,
      trackId: track.id,
      speakerIds: [speaker.id],
    },
    ctx(),
    ports,
  );
  await executeCommand(
    createExhibitorCommand,
    { eventId: event.id, name: `${name} Exhibitor`, boothLabel: 'B1' },
    ctx(),
    ports,
  );
  const tier = await executeCommand(
    createSponsorTierCommand,
    { eventId: event.id, name: 'Gold', position: 1 },
    ctx(),
    ports,
  );
  await executeCommand(
    createSponsorCommand,
    { eventId: event.id, tierId: tier.id, name: `${name} Sponsor` },
    ctx(),
    ports,
  );
  await draftEventCopy(ctx(), ports, fakeDrafter, { eventId: event.id, kind: 'tagline' });
  // M1.4g: a published page (linked from the tenant site's navigation) and a published post; a
  // review by the fixture buyer after the event ended, and one report of it.
  const page = await executeCommand(
    createEntryCommand,
    {
      kind: 'page',
      title: `About ${name}`,
      body: '## Who we are\n\nFixture page.',
      authorName: 'Fixture Owner',
    },
    ctx(),
    ports,
  );
  await executeCommand(setEntryStatusCommand, { entryId: page.id, action: 'publish' }, ctx(), ports);
  const post = await executeCommand(
    createEntryCommand,
    { kind: 'post', title: `${name} news`, body: 'Fixture post.', authorName: 'Fixture Owner' },
    ctx(),
    ports,
  );
  await executeCommand(setEntryStatusCommand, { entryId: post.id, action: 'publish' }, ctx(), ports);
  await executeCommand(updateSiteSettingsCommand, { navPageIds: [page.id] }, ctx(), ports);
  const afterEvent = new Date('2027-10-20T12:00:00Z');
  await executeCommand(
    submitReviewCommand,
    { manageToken: checkout.manageToken, rating: 4, body: 'Great fixture event.' },
    createCtx({ orgId: org.id, now: afterEvent }),
    ports,
  );
  const [review] = await withTenant(systemCtx(org.id), (tx) =>
    tx.execute<{ id: string }>(sql`select id from reviews.reviews order by created_at limit 1`),
  );
  if (review)
    await executeCommand(
      reportReviewCommand,
      { reviewId: review.id, reason: 'spam', clientKey: `fixture-device-${slug}` },
      createCtx({ orgId: org.id }),
      ports,
    );
  // M3.6 audiences: the participation projector catches up on everything above (live rows and
  // profiles), and one saved audience (isolation coverage).
  await catchUpParticipation(org.id);
  await executeCommand(
    saveSegmentCommand,
    {
      name: 'Launch no-shows',
      definition: templateDefinition('registeredNotCheckedIn', { eventId: event.id }),
    },
    ctx(),
    ports,
  );
  // M3.6b campaigns: a sent campaign (recipient snapshot, tracked link, stored content) to the
  // org's email subscribers (the fixture buyer opted in), released by the scheduler (isolation coverage).
  const campaign = await executeCommand(
    createCampaignCommand,
    { name: `Fixture news ${slug}` },
    ctx(),
    ports,
  );
  await executeCommand(
    saveCampaignCommand,
    {
      campaignId: campaign.id,
      name: campaign.name,
      locale: 'en',
      content: {
        subject: 'News for {{first_name|you}}',
        preheader: '',
        font: 'sans',
        smsBody: '',
        blocks: [
          { id: 'b1', type: 'heading', text: 'Hello {{first_name|there}}' },
          { id: 'b2', type: 'button', label: 'See the event', eventId: event.id, path: null },
          { id: 'b3', type: 'footer', postalAddress: `1 ${name} Way, Chicago IL`, note: '' },
        ],
      },
    },
    ctx(),
    ports,
  );
  const subscribers = await executeCommand(
    saveSegmentCommand,
    {
      name: 'Email subscribers',
      definition: {
        version: 1,
        root: {
          type: 'group',
          op: 'and',
          conditions: [{ type: 'consent', channel: 'email', granted: true }],
        },
      },
    },
    ctx(),
    ports,
  );
  await executeCommand(
    setAudienceCommand,
    { campaignId: campaign.id, audience: { kind: 'segment', segmentId: subscribers.id } },
    ctx(),
    ports,
  );
  await executeCommand(
    sendNowCommand,
    { campaignId: campaign.id },
    ctx({ idempotencyKey: `fixture-campaign-${slug}` }),
    ports,
  );
  await runOrgCampaigns(org.id, ports);
  // M3.1a: the metrics projector (snapshots, sharded counter, time series, lag samples) and the
  // analytics sink over this org's outbox, as the worker would.
  await catchUpMetrics(org.id);
  await catchUpSubscriber(analyticsForwarder(postgresAnalyticsSink), org.id);
  return { org, ownerId, viewerId, event, apiKey, testKey, ctx };
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
    seat: 'Seat',
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
