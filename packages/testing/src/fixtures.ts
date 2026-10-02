import { createECDH } from 'node:crypto';
import { draftEventCopy, fakeDrafter } from '@yayatoh/ai';
import {
  acknowledgeAlertCommand,
  evaluateEventAlertsTx,
  listAlertsQuery,
  setAlertRoutingCommand,
  setMyAlertPhoneCommand,
  setSalesTargetCommand,
} from '@yayatoh/alerts';
import {
  assignCommand as assistanceAssignCommand,
  addNoteCommand as assistanceNoteCommand,
  queueQuery as assistanceQueueQuery,
  assistanceTicketToken,
  guestRequestCommand,
  staffRequestCommand,
} from '@yayatoh/assistance';
import {
  attendeeImportBulk,
  attendeeLabelBulk,
  stageImportCommand,
  validateImportCommand,
} from '@yayatoh/attendees';
import { catchUpParticipation, saveSegmentCommand, templateDefinition } from '@yayatoh/audiences';
import { createJourneyCommand, journeyTriggers, setJourneyEnabledCommand } from '@yayatoh/automations';
import {
  assignTemplateCommand,
  createTemplateCommand,
  runBadgeBatch,
  startBatchCommand,
} from '@yayatoh/badges';
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
  claimStaffPushCommand,
  createCheckpointCommand,
  enrollDeviceCommand,
  heartbeatCommand,
  markQuietDevicesTx,
  reportPresenceCommand,
  scanTicketCommand,
  setDetectionSettingsCommand,
  stageStaffAlertPushesTx,
  startKioskCommand,
  subscribeStaffPushCommand,
} from '@yayatoh/checkin';
import {
  createEntryCommand,
  createHelpArticleCommand,
  createHelpCategoryCommand,
  createSiteSectionCommand,
  setEntryStatusCommand,
  setHelpArticleStatusCommand,
  setSiteSectionStatusCommand,
  submitContactRequestCommand,
  submitHelpFeedbackCommand,
} from '@yayatoh/cms';
import {
  createDisplayLinkCommand,
  saveWidgetLayoutCommand,
  setModeOverrideCommand,
} from '@yayatoh/command-center';
import { withTenant } from '@yayatoh/db';
import {
  addRecurringOccurrencesCommand,
  addSectionCommand,
  assignEventRoleCommand,
  cancelOccurrenceCommand,
  createAccessCodeCommand,
  createAnnouncementCommand,
  createEventCommand,
  createPortalSession,
  createSeriesCommand,
  type EventDto,
  listOccurrencesQuery,
  portalCtx,
  portalPrincipalBySession,
  redeemAccessCodeCommand,
  setEventDetailsCommand,
  setEventSeriesCommand,
  setPrivateInfoCommand,
  transitionEventCommand,
} from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import {
  publishFormCommand,
  publishRegistrationFormCommand,
  saveRegistrationPageCommand,
  setJobTitlesCommand,
  startRegistrationFormCommand,
} from '@yayatoh/forms';
import {
  addPartyGuestCommand,
  addPlusOneCommand,
  createPartyCommand,
  createSubEventCommand,
  guessGuestMapping,
  guestImportBulk,
  moveGuestCommand,
  readGuestTable,
  recordSubEventResponseCommand,
  setInvitationsCommand,
  stageGuestImportCommand,
  updatePartyGuestCommand,
  validateGuestImportCommand,
} from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  attributeOrderCommand,
  createTrackedLinkCommand,
  recordClickCommand,
  setAttributionWindowCommand,
} from '@yayatoh/marketing';
import { addLegacyRedirectCommand, catchUpListings, updateSiteSettingsCommand } from '@yayatoh/marketplace';
import { uploadLogo, uploadMedia, uploadProgramImage, uploadSpeakerPortalFile } from '@yayatoh/media';
import {
  announcementMailer,
  contactMessageCommand,
  contactReportCommand,
  reportThreadCommand,
  sendAnnouncementCommand,
  threadToken,
} from '@yayatoh/messaging';
import {
  addSendingDomainCommand,
  createNotifier,
  dispatchDue,
  fakeIdentityPort,
  memoryTransports,
  recordDeliveryEventsCommand,
  recordInboundKeywordCommand,
  recordSendingDomainCheckCommand,
  registerPushTokenCommand,
  sendTestNotificationCommand,
  setChannelSenderCommand,
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
  issueCreditNoteCommand,
  refundRequestsQuery,
  registerOrderPushCommand,
  requestRefundCommand,
  runSupportMacroCommand,
  saveSupportMacroCommand,
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
  assignBoothCommand,
  claimSessionPlaceTx,
  createExhibitorCommand,
  createPortalTaskCommand,
  createRoomCommand,
  createSessionCommand,
  createSessionGroupCommand,
  createSessionTypeCommand,
  createSpeakerCommand,
  createSponsorCommand,
  createSponsorTierCommand,
  createTrackCommand,
  inviteExhibitorMemberCommand,
  inviteSpeakerCommand,
  portalInviteStaffCommand,
  portalSaveProfileCommand,
  proposeProfileChangeCommand,
  publishAgendaCommand,
  recordGroupPickTx,
  saveBoothCommand,
  saveExhibitorListingCommand,
  saveExhibitorSettingsCommand,
  setSessionAgendaCommand,
  speakerPortalQuery,
} from '@yayatoh/program';
import {
  createRegistrationTypeCommand,
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
} from '@yayatoh/registration';
import {
  analyticsForwarder,
  attendeeExportBulk,
  catchUpMetrics,
  postgresAnalyticsSink,
} from '@yayatoh/reports';
import { reportReviewCommand, submitReviewCommand } from '@yayatoh/reviews';
import {
  assignSeatsCommand,
  giveSubEventOwnChartCommand,
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
  createSandboxCommand,
  deleteSandboxCommand,
  inviteMemberCommand,
  type OrganizationDto,
  PLATFORM_AGREEMENTS,
  recordApiKeyUsage,
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
import { createEndpointCommand } from '@yayatoh/webhooks';
import { sql } from 'drizzle-orm';
import { ports, runBulk, submitRegistrationForm } from './ports.ts';

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
  /** M5.3a: the fixture speaker and their portal account (session cookie value on `fixture.test`). */
  readonly speakerId: string;
  readonly portal: { readonly accountId: string; readonly token: string };
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
  // M5.1b: a registration form, the job title list, one submitted respondent (consent checked,
  // company named) and one draft with a sensitive answer, so respondents, job titles and
  // companies are covered.
  await executeCommand(
    publishRegistrationFormCommand,
    {
      eventId: event.id,
      definition: {
        pages: [
          {
            key: 'about',
            title: 'About you',
            fields: [
              { key: 'company', type: 'company', label: 'Company' },
              { key: 'job', type: 'job_title', label: 'Job title' },
              { key: 'access', type: 'short_text', label: 'Access needs', sensitive: true },
              {
                key: 'share_email',
                type: 'consent',
                label: 'Exhibitors may receive my email',
                consent: { term: 'exhibitor_email_sharing', version: 1 },
              },
            ],
          },
        ],
      },
    },
    ctx(),
    ports,
  );
  await executeCommand(setJobTitlesCommand, { titles: ['Engineer', 'Director'] }, ctx(), ports);
  for (const [who, submit] of [
    ['respondent', true],
    ['drafter', false],
  ] as const) {
    const { token } = await executeCommand(
      startRegistrationFormCommand,
      {
        eventId: event.id,
        registrationTypeId: 'fixture-type',
        name: `Fixture ${who}`,
        email: `${who}@${slug}.test`,
      },
      ctx(),
      ports,
    );
    const answers = { company: `${name} Partner`, job: 'Engineer', access: 'Step-free', share_email: true };
    if (submit)
      await executeCommand(submitRegistrationForm, { token, pageKey: 'about', answers }, ctx(), ports);
    else
      await executeCommand(
        saveRegistrationPageCommand,
        { token, pageKey: 'about', answers, intent: 'stay' },
        ctx(),
        ports,
      );
  }
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
  // M3.7a: a switched-on journey for the event; the paid order above enrolls the buyer (a run
  // with its scheduled steps, both still ahead).
  const journey = await executeCommand(
    createJourneyCommand,
    {
      name: `${name} welcome`,
      eventId: event.id,
      trigger: 'order_paid',
      steps: [
        {
          anchor: 'event_start',
          offsetDays: -2,
          action: 'email',
          subject: 'Soon: {event}',
          body: 'Hi {name}!',
        },
        { anchor: 'event_start', offsetDays: -1, action: 'label', label: 'Reminded' },
      ],
    },
    ctx(),
    ports,
  );
  await executeCommand(setJourneyEnabledCommand, { journeyId: journey.id, enabled: true }, ctx(), ports);
  await catchUpSubscriber(journeyTriggers(), org.id);
  // M5.5a badges: a template (and its version) assigned to the pass, and a batch with one
  // rendered part left running (a fake renderer: no Gotenberg in the fixture).
  const badgeTemplate = await executeCommand(
    createTemplateCommand,
    { eventId: event.id, name: 'Fixture badge', size: 'fold_4x3' },
    ctx(),
    ports,
  );
  await executeCommand(
    assignTemplateCommand,
    { eventId: event.id, ticketTypeId: ga.id, templateId: badgeTemplate.id },
    ctx(),
    ports,
  );
  const badgeBatch = await executeCommand(
    startBatchCommand,
    { eventId: event.id, requestKey: `fixture-${slug}`, sort: 'last_name' },
    ctx(),
    ports,
  );
  await runBadgeBatch(
    { ports, renderer: { render: async () => new TextEncoder().encode('%PDF-fixture') } },
    org.id,
    badgeBatch.id,
    { maxChunks: 1 },
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
  const door = await executeCommand(enrollDeviceCommand, { label: `Door ${slug}` }, ctx(), ports);
  // Org API keys: one live with every scope, one test key (M1.13d), one revoked (isolation coverage).
  const { key: apiKey, id: apiKeyId } = await executeCommand(
    createApiKeyCommand,
    { name: `Fixture ${slug}`, scopes: [...API_KEY_SCOPES] },
    ctx(),
    ports,
  );
  // M6.3a: one day of the key's usage, and a sandbox org linked to this org (isolation coverage).
  await recordApiKeyUsage({ orgId: org.id, keyId: apiKeyId, status: 200 });
  // Only the parent's link row (no sandbox org is provisioned, so fixtures add no org that
  // org-wide jobs must walk), deleted again so the org's live sandbox count starts at zero.
  const sandbox = await executeCommand(createSandboxCommand, { name: `Sandbox of ${name}` }, ctx(), ports);
  await executeCommand(deleteSandboxCommand, { sandboxId: sandbox.id }, ctx(), ports);
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
    tx.execute<{ id: string; short_code: string }>(
      sql`select id, short_code from ticketing.tickets order by serial limit 1`,
    ),
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
  // Staff mode (M3.4a): the door device reports in at the main gate, opts in to staff alerts,
  // and is taken by the owner as a supervisor's phone; a capacity alert is queued for it.
  // Dated at event time, so the fixture device doesn't count as online now (devices.online metric).
  const deviceCtx = createCtx({
    orgId: org.id,
    actor: { type: 'system', name: `device:${door.deviceId}` },
    now: new Date('2027-10-14T14:55:00Z'),
  });
  await executeCommand(
    heartbeatCommand,
    { batteryPct: 80, queueDepth: 0, clockOffsetMs: 0, eventId: event.id, checkpointId: mainGate },
    deviceCtx,
    ports,
  );
  const pushKey = createECDH('prime256v1');
  pushKey.generateKeys();
  const copy = { title: 'Alert', body: '{label} {percent}' };
  await executeCommand(
    subscribeStaffPushCommand(() => true),
    {
      endpoint: `https://push.example.test/fixture-${slug}`,
      keys: { p256dh: pushKey.getPublicKey().toString('base64url'), auth: 'AAAAAAAAAAAAAAAAAAAAAA' },
      locale: 'en',
      copy: { device_offline: copy, device_low_battery: copy, device_backlog: copy, capacity_near: copy },
    },
    deviceCtx,
    ports,
  );
  await executeCommand(
    claimStaffPushCommand,
    { eventId: event.id, deviceId: door.deviceId, supervisor: true },
    ctx(),
    ports,
  );
  await withTenant(systemCtx(org.id), (tx) =>
    stageStaffAlertPushesTx(
      tx,
      {
        list: async () => [
          {
            key: `capacity_near:${event.id}:fixture`,
            kind: 'capacity_near',
            severity: 'warning',
            deviceId: null,
            deviceLabel: null,
            percent: 91,
            count: null,
            since: new Date(),
            supervisorOnly: false,
          },
        ],
      },
      event.id,
      new Date(),
    ),
  );
  await executeCommand(
    startKioskCommand,
    { eventId: event.id, deviceId: door.deviceId, checkpointId: sideGate, pin: '2468' },
    ctx(),
    ports,
  );
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
  // M3.10c support tools (isolation coverage): a store credit note on the paid order with a little
  // of it spent, a macro run on the order (a team note), and a cancelled transfer of the first
  // ticket with the recipient's wallet pass, voided (inserted directly so holders stay as they are).
  const note = await executeCommand(
    issueCreditNoteCommand,
    {
      orderId: checkout.order.id,
      kind: 'partial',
      amountMinor: 100,
      disposition: 'store_credit',
      reason: 'Goodwill for the late doors.',
    },
    ctx({ idempotencyKey: `fixture-credit-${slug}` }),
    ports,
  );
  await withTenant(systemCtx(org.id), async (tx) => {
    await tx.execute(sql`
      update orders.credit_notes set balance_minor = balance_minor - 1 where id = ${note.id}`);
    await tx.execute(sql`
      insert into orders.credit_note_applications (org_id, credit_note_id, order_id, amount_minor)
      values (${org.id}, ${note.id}, ${checkout.order.id}, 1)`);
  });
  const macro = await executeCommand(
    saveSupportMacroCommand,
    {
      name: 'Called the buyer',
      subject: 'About your order {{order_ref}}',
      body: 'Spoke with {{buyer_name}} about {{event_name}}.',
      actions: ['add_note'],
    },
    ctx(),
    ports,
  );
  await executeCommand(
    runSupportMacroCommand,
    { orderId: checkout.order.id, macroId: macro.id },
    ctx({ idempotencyKey: `fixture-macro-${slug}` }),
    ports,
  );
  if (held)
    await withTenant(systemCtx(org.id), async (tx) => {
      const [claim] = await tx.execute<{ id: string }>(sql`
        insert into ticketing.ticket_claims (org_id, ticket_id, recipient_email, expires_at, revoked_at, created_by)
        values (${org.id}, ${held.id}, ${`friend@${slug}.test`}, now() + interval '7 days', now(), 'fixture')
        returning id`);
      await tx.execute(sql`
        insert into ticketing.ticket_transfers (org_id, ticket_id, event_id, order_id, claim_id, status,
          initiated_by, from_name, from_email, to_name, to_email, currency, created_by, from_rev, cancelled_at)
        values (${org.id}, ${held.id}, ${event.id}, ${checkout.order.id}, ${claim?.id}, 'cancelled', 'holder',
          'Fixture Buyer', ${held.holder_email}, 'Fixture Friend', ${`friend@${slug}.test`}, 'USD', 'fixture', 0, now())`);
      await tx.execute(sql`
        insert into ticketing.wallet_passes (org_id, ticket_id, rev, serial, holder_name, status, voided_at)
        values (${org.id}, ${held.id}, 999, ${`yy-${held.id}-999`}, 'Fixture Friend', 'voided', now())`);
    });
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
  // Provider adapters (M3.5b): a verified sending domain, dedicated SMS and WhatsApp senders (ids
  // derived from the org id, so unique platform-wide) and an inbound STOP (isolation coverage).
  const sending = await executeCommand(
    addSendingDomainCommand,
    { domain: `mail.${slug}.example.test`, provider: 'fake' },
    ctx(),
    ports,
  );
  const identity = await fakeIdentityPort().status(sending.domain);
  await executeCommand(
    recordSendingDomainCheckCommand,
    {
      id: sending.id,
      dkim: identity.dkim,
      spf: identity.spf,
      dmarc: 'verified',
      dmarcPolicy: 'none',
      records: identity.records,
      providerRef: identity.providerRef,
    },
    ctx(),
    ports,
  );
  const hex = org.id.replace(/-/g, '');
  await executeCommand(
    setChannelSenderCommand,
    { kind: 'sms', messagingServiceSid: `MG${hex}`, displayNumber: null, campaignStatus: 'verified' },
    systemCtx(org.id),
    ports,
  );
  await executeCommand(
    setChannelSenderCommand,
    {
      kind: 'whatsapp',
      route: 'cloud',
      senderRef: BigInt(`0x${hex.slice(-13)}`).toString(),
      displayNumber: null,
    },
    systemCtx(org.id),
    ports,
  );
  await executeCommand(
    recordInboundKeywordCommand,
    {
      provider: 'twilio',
      id: `fixture-stop-${slug}`,
      channel: 'sms',
      keyword: 'stop',
      from: '+19995550100',
      receivedAt: new Date(),
    },
    systemCtx(org.id),
    ports,
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
  const exhibitor = await executeCommand(
    createExhibitorCommand,
    { eventId: event.id, name: `${name} Exhibitor`, boothLabel: 'B1' },
    ctx(),
    ports,
  );
  // M5.4a: the exhibitor portal (settings, listing, an admin signed in by link, a staff invite, a
  // pending profile change) and a booth with the exhibitor at it.
  await executeCommand(
    saveExhibitorSettingsCommand,
    { eventId: event.id, defaultStaffAllowance: 3, approvalRequired: true },
    ctx(),
    ports,
  );
  await executeCommand(
    saveExhibitorListingCommand,
    {
      eventId: event.id,
      exhibitorId: exhibitor.id,
      listed: true,
      categories: ['Software'],
      links: [{ label: 'Docs', url: 'https://example.com/docs' }],
      staffAllowance: null,
    },
    ctx(),
    ports,
  );
  // The exhibitor admin is a portal account (M5.3a), signed in like any portal person.
  const exhibitorInvite = await executeCommand(
    inviteExhibitorMemberCommand,
    { eventId: event.id, exhibitorId: exhibitor.id, email: `admin@${slug}.example`, role: 'exhibitor_admin' },
    ctx(),
    ports,
  );
  const exhibitorSession = await createPortalSession({
    orgId: org.id,
    accountId: exhibitorInvite.member.id,
    host: 'fixture.test',
  });
  const exhibitorPrincipal = await portalPrincipalBySession(exhibitorSession.token, 'fixture.test');
  if (!exhibitorPrincipal) throw new Error('fixture: exhibitor portal session');
  const exhibitorCtx = portalCtx(exhibitorPrincipal);
  await executeCommand(portalInviteStaffCommand, { email: `staff@${slug}.example` }, exhibitorCtx, ports);
  await executeCommand(
    portalSaveProfileCommand,
    { name: `${name} Exhibitor`, description: 'Proposed *copy*.' },
    exhibitorCtx,
    ports,
  );
  const hall = await executeCommand(
    saveBoothCommand,
    { eventId: event.id, number: 'A1', category: 'Software', x: 100, y: 100, width: 300, height: 300 },
    ctx(),
    ports,
  );
  await executeCommand(
    assignBoothCommand,
    { eventId: event.id, boothId: hall.booths[0]?.id ?? '', exhibitorId: exhibitor.id },
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
  // M5.2a: agenda model v2 on the weekly event (so the launch event's agenda stays live): a
  // session type, a pick-one group with an optional workshop in it, one claimed place and one
  // group pick, a speaker with an email (the CSV import's match key), and a published agenda.
  const workshopType = await executeCommand(
    createSessionTypeCommand,
    { eventId: weekly.id, name: 'Workshop' },
    ctx(),
    ports,
  );
  const pickOne = await executeCommand(
    createSessionGroupCommand,
    { eventId: weekly.id, name: 'Pick one' },
    ctx(),
    ports,
  );
  const workshop = await executeCommand(
    createSessionCommand,
    {
      eventId: weekly.id,
      title: 'Hands-on workshop',
      startsAt: weekly.startsAt,
      endsAt: new Date(weekly.startsAt.getTime() + 3_600_000),
      capacity: 30,
    },
    ctx(),
    ports,
  );
  await executeCommand(
    setSessionAgendaCommand,
    {
      eventId: weekly.id,
      sessionId: workshop.session.id,
      typeId: workshopType.id,
      admission: 'optional',
      groupId: pickOne.id,
    },
    ctx(),
    ports,
  );
  const weeklySpeaker = await executeCommand(
    createSpeakerCommand,
    { eventId: weekly.id, name: `${name} Host` },
    ctx(),
    ports,
  );
  await withTenant(systemCtx(org.id), async (tx) => {
    await claimSessionPlaceTx(tx, workshop.session.id);
    await recordGroupPickTx(tx, systemCtx(org.id), {
      groupId: pickOne.id,
      sessionId: workshop.session.id,
      registrantId: uuidv7(),
    });
    await tx.execute(
      sql`insert into program.speaker_contacts (org_id, event_id, speaker_id, email) values (${org.id}, ${weekly.id}, ${weeklySpeaker.id}, ${`host@${slug}.test`})`,
    );
  });
  await executeCommand(publishAgendaCommand, { eventId: weekly.id }, ctx(), ports);
  // M5.3a speaker portal: the speaker's portal account (and its event-role assignment), a sign-in
  // code and a session, a proposed profile change, and an upload task answered with a file.
  const invited = await executeCommand(
    inviteSpeakerCommand,
    { eventId: event.id, speakerId: speaker.id, email: `speaker-${slug}@example.test` },
    ctx(),
    ports,
  );
  const portalSession = await createPortalSession({
    orgId: org.id,
    accountId: invited.accountId,
    host: 'fixture.test',
  });
  await withTenant(systemCtx(org.id), (tx) =>
    tx.execute(sql`
      insert into events.portal_challenges
        (org_id, account_id, code_hash, expires_at, link_hash, browser_hash, link_expires_at)
      values (${org.id}, ${invited.accountId}, ${'0'.repeat(64)}, now(), ${'1'.repeat(64)}, ${'2'.repeat(64)}, now())`),
  );
  const principal = await portalPrincipalBySession(portalSession.token, 'fixture.test');
  if (!principal) throw new Error('fixture: portal session');
  const speakerCtx = portalCtx(principal);
  await executeCommand(
    proposeProfileChangeCommand,
    { name: `${name} Speaker`, company: name, bio: 'Talks about *portals*.' },
    speakerCtx,
    ports,
  );
  await executeCommand(
    createPortalTaskCommand,
    {
      eventId: event.id,
      kind: 'upload',
      title: 'Upload your slides',
      dueAt: new Date(event.startsAt.getTime() - 86_400_000),
    },
    ctx(),
    ports,
  );
  const speakerView = await executeQuery(speakerPortalQuery, {}, speakerCtx, ports);
  const slidesTask = speakerView.tasks[0];
  if (!slidesTask) throw new Error('fixture: speaker task');
  await uploadSpeakerPortalFile(
    speakerCtx,
    {
      purpose: 'task_answer',
      assigneeId: slidesTask.assigneeId,
      file: new TextEncoder().encode('%PDF-1.4\n% fixture slides\n%%EOF\n'),
      fileName: 'slides.pdf',
    },
    ports,
  );
  await draftEventCopy(ctx(), ports, fakeDrafter, { eventId: event.id, kind: 'tagline' });
  // M5.1a registration: the default types and items (activating the conference pack), a code-only
  // and a domain-only type, one cell per type, and a capacity claim.
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: event.id, names: {} }, ctx(), ports);
  const regSetup = await executeQuery(registrationSetupQuery, { eventId: event.id }, ctx(), ports);
  const fullPass = regSetup.items.find((i) => i.key === 'full_pass');
  const member = regSetup.types.find((t) => t.key === 'member');
  const press = await executeCommand(
    createRegistrationTypeCommand,
    {
      eventId: event.id,
      name: 'Press',
      eligibility: 'access_code',
      accessCode: `PRESS-${slug}`.slice(0, 32).toUpperCase(),
    },
    ctx(),
    ports,
  );
  const staff = await executeCommand(
    createRegistrationTypeCommand,
    {
      eventId: event.id,
      name: 'Staff',
      eligibility: 'email_domain',
      emailDomains: ['example.test'],
      capacity: 10,
    },
    ctx(),
    ports,
  );
  if (fullPass && member) {
    for (const [typeId, priceMinor] of [
      [member.id, 0],
      [press.id, 0],
      [staff.id, 2500],
    ] as const)
      await executeCommand(
        setCellCommand,
        { eventId: event.id, registrationTypeId: typeId, admissionItemId: fullPass.id, priceMinor },
        ctx(),
        ports,
      );
    // A capacity claim on the fixture's order (counting nothing): no second order, so tests that
    // count the fixture's orders are unchanged.
    await withTenant(systemCtx(org.id), (tx) =>
      tx.execute(sql`insert into registration.capacity_claims (org_id, event_id, registration_type_id, order_id)
        values (${org.id}, ${event.id}, ${member.id}, ${checkout.order.id})`),
    );
  }
  // M4.1a: a party with a named guest (sealed answers, linked to a guest-list entry), a child and
  // an unnamed plus-one; then an edit and a move, so every history action has rows.
  const party = await executeCommand(
    createPartyCommand,
    {
      eventId: event.id,
      name: `${name} Family`,
      envelopeName: `The ${name} Family`,
      side: 'Both',
      vip: true,
      tags: ['Family'],
      notes: 'Fixture notes.',
    },
    ctx(),
    ports,
  );
  const [linked] = await withTenant(systemCtx(org.id), (tx) =>
    tx.execute<{ id: string }>(
      sql`select id from attendees.attendees where event_id = ${event.id} order by created_at limit 1`,
    ),
  );
  const host = await executeCommand(
    addPartyGuestCommand,
    {
      eventId: event.id,
      partyId: party.id,
      firstName: 'Fixture',
      lastName: 'Guest',
      meal: 'Fish',
      dietary: 'No nuts',
      accessibility: 'Step-free seat',
      address: '1 Fixture Lane',
      attendeeId: linked?.id ?? null,
    },
    ctx(),
    ports,
  );
  await executeCommand(
    addPartyGuestCommand,
    {
      eventId: event.id,
      partyId: party.id,
      firstName: 'Kid',
      lastName: 'Guest',
      ageClass: 'child',
      source: 'paper',
    },
    ctx(),
    ports,
  );
  await executeCommand(addPlusOneCommand, { eventId: event.id, hostGuestId: host.id }, ctx(), ports);
  const second = await executeCommand(
    createPartyCommand,
    { eventId: event.id, name: `${name} Friends`, side: 'Work' },
    ctx(),
    ports,
  );
  const friend = await executeCommand(
    addPartyGuestCommand,
    { eventId: event.id, partyId: second.id, firstName: 'Friend', lastName: 'Guest' },
    ctx(),
    ports,
  );
  await executeCommand(
    updatePartyGuestCommand,
    { eventId: event.id, guestId: friend.id, firstName: 'Friend', lastName: 'Guest', meal: 'Vegetarian' },
    ctx(),
    ports,
  );
  await executeCommand(
    moveGuestCommand,
    { eventId: event.id, guestId: friend.id, toPartyId: party.id },
    ctx(),
    ports,
  );
  // M4.1c: a ceremony (everyone invited) and a reception (the named host invited, so their
  // plus-one follows) with its own chart, and a paper response.
  const ceremony = await executeCommand(
    createSubEventCommand,
    {
      eventId: event.id,
      name: 'Ceremony',
      kind: 'ceremony',
      startsAt: event.startsAt,
      endsAt: new Date(event.startsAt.getTime() + 3_600_000),
      place: 'The garden',
      inviteAll: true,
    },
    ctx(),
    ports,
  );
  const reception = await executeCommand(
    createSubEventCommand,
    {
      eventId: event.id,
      name: 'Reception',
      kind: 'reception',
      startsAt: new Date(event.startsAt.getTime() + 3_600_000),
      endsAt: new Date(event.startsAt.getTime() + 4 * 3_600_000),
    },
    ctx(),
    ports,
  );
  await executeCommand(
    setInvitationsCommand,
    {
      eventId: event.id,
      subEventIds: [reception.id],
      target: { kind: 'guests', guestIds: [host.id] },
      invited: true,
    },
    ctx(),
    ports,
  );
  await executeCommand(
    recordSubEventResponseCommand,
    { eventId: event.id, guestId: host.id, subEventId: reception.id, status: 'attending', source: 'paper' },
    ctx(),
    ports,
  );
  await executeCommand(
    recordSubEventResponseCommand,
    { eventId: event.id, guestId: host.id, subEventId: ceremony.id, status: 'declined' },
    ctx(),
    ports,
  );
  await executeCommand(
    giveSubEventOwnChartCommand,
    { eventId: event.id, subEventId: reception.id, layoutId: layout.id },
    ctx(),
    ports,
  );
  // M4.1b: a pasted guest list staged, checked and imported (a household with a plus-one and a
  // child, sealed answers; one rejected row kept sealed for its download), and a second list
  // left staged, so both import tables hold rows.
  const pasted = readGuestTable({
    source: 'paste',
    text: `Household\tName\tAge\tDietary\tPlus one\n${name} Imported\tImported Guest\t\tNo shellfish\tyes\n${name} Imported\tImported Kid\tchild\t\t\n\tGuest of Nobody\t\t\t\n`,
  });
  const guestBatch = await executeCommand(
    stageGuestImportCommand,
    {
      eventId: event.id,
      source: 'paste',
      headers: [...pasted.headers],
      rows: pasted.rows.map((r) => [...r]),
    },
    ctx(),
    ports,
  );
  await executeCommand(
    validateGuestImportCommand,
    { eventId: event.id, batchId: guestBatch.batchId, mapping: guessGuestMapping(pasted.headers) },
    ctx(),
    ports,
  );
  const guestImport = await executeCommand(
    guestImportBulk.start,
    { eventId: event.id, selection: { filter: { batchId: guestBatch.batchId } }, params: {} },
    ctx(),
    ports,
  );
  await runBulk(org.id, guestImport.operationId);
  await executeCommand(
    stageGuestImportCommand,
    {
      eventId: event.id,
      source: 'csv',
      fileName: 'later.csv',
      headers: ['First name', 'Last name', 'Address'],
      rows: [['Staged', 'Guest', '2 Fixture Road']],
    },
    ctx(),
    ports,
  );
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
  // M3.11b: a help category with a published article and one "helpful" answer, a published
  // marketing section and a contact request.
  const helpCategory = await executeCommand(
    createHelpCategoryCommand,
    { audience: 'organizers', title: `${name} basics` },
    ctx(),
    ports,
  );
  const helpArticle = await executeCommand(
    createHelpArticleCommand,
    { categoryId: helpCategory.id, title: `Getting started with ${name}`, body: 'Fixture article.' },
    ctx(),
    ports,
  );
  await executeCommand(
    setHelpArticleStatusCommand,
    { articleId: helpArticle.id, action: 'publish' },
    ctx(),
    ports,
  );
  await executeCommand(
    submitHelpFeedbackCommand,
    { slug: helpArticle.slug, locale: 'en', helpful: true, voterKey: 'f'.repeat(64) },
    createCtx({ orgId: org.id }),
    ports,
  );
  const section = await executeCommand(
    createSiteSectionCommand,
    { placement: 'home', heading: `Why ${name}`, body: 'Fixture section.' },
    ctx(),
    ports,
  );
  await executeCommand(
    setSiteSectionStatusCommand,
    { sectionId: section.id, action: 'publish' },
    ctx(),
    ports,
  );
  await executeCommand(
    submitContactRequestCommand,
    {
      topic: 'sales',
      name: 'Fixture Buyer',
      email: `sales-${slug}@example.test`,
      message: 'We would like a demo please.',
    },
    createCtx({ orgId: org.id }),
    ports,
  );
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
  // M3.2a Command Center: the owner's own layout and a manual mode (isolation coverage).
  // Guest assistance (M3.3b): a guest asks for help with their ticket's link, the door device asks
  // for backup, the owner takes the guest's request and writes a note (every assistance table).
  await executeCommand(
    guestRequestCommand,
    {
      eventId: event.id,
      ticketToken: assistanceTicketToken(issued?.id ?? ''),
      reason: 'seat',
      note: 'Someone is in my seat',
      location: 'Row C',
    },
    createCtx({ orgId: org.id, now: new Date('2027-10-14T15:05:00Z') }),
    ports,
  );
  await executeCommand(
    staffRequestCommand,
    { eventId: event.id, reason: 'backup', note: 'Long line', checkpointId: mainGate },
    deviceCtx,
    ports,
  );
  const [guestAsk] = await executeQuery(assistanceQueueQuery, { eventId: event.id }, ctx(), ports);
  if (!guestAsk) throw new Error('fixture: no help request');
  await executeCommand(
    assistanceAssignCommand,
    { eventId: event.id, requestId: guestAsk.id, assignee: 'me' },
    ctx(),
    ports,
  );
  await executeCommand(
    assistanceNoteCommand,
    { eventId: event.id, requestId: guestAsk.id, body: 'On my way' },
    ctx(),
    ports,
  );
  await executeCommand(
    saveWidgetLayoutCommand,
    { eventId: event.id, order: ['sales', 'readiness'], hidden: ['timeline'] },
    ctx(),
    ports,
  );
  await executeCommand(setModeOverrideCommand, { eventId: event.id, mode: 'pre_show' }, ctx(), ports);

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
  // M3.3a live mode: the owner at the main gate (staff presence), a TV display link, and the door
  // device's transitions (its first heartbeat above recorded "online"; it went quiet since).
  await executeCommand(
    reportPresenceCommand,
    { eventId: event.id, checkpointId: mainGate },
    ctx({ now: new Date('2027-10-14T15:02:00Z') }),
    ports,
  );
  await executeCommand(createDisplayLinkCommand, { eventId: event.id, label: 'Lobby screen' }, ctx(), ports);
  const quietCtx = { ...systemCtx(org.id), now: new Date('2027-10-14T15:30:00Z') };
  await withTenant(quietCtx, (tx) => markQuietDevicesTx(tx, quietCtx, 90_000));
  // M3.1a: the metrics projector (snapshots, sharded counter, time series, lag samples) and the
  // analytics sink over this org's outbox, as the worker would.
  await catchUpMetrics(org.id);
  await catchUpSubscriber(analyticsForwarder(postgresAnalyticsSink), org.id);
  // M3.2b alert engine: the fixture event's unseated ticket holders raise an alert (evaluated as
  // the worker would, a day before the event), the owner acknowledges it; one routing row, the
  // owner's alert number and a sales target (isolation coverage of every alerts table).
  const alertCtx = { ...systemCtx(org.id), now: new Date(event.startsAt.getTime() - 86_400_000 * 3) };
  await withTenant(alertCtx, (tx) =>
    evaluateEventAlertsTx(tx, alertCtx, event.id, { notifier: createNotifier() }),
  );
  const [fixtureAlert] = await executeQuery(listAlertsQuery, { eventId: event.id }, ctx(), ports);
  if (!fixtureAlert) throw new Error('fixture: the fixture event raised no alert');
  await executeCommand(acknowledgeAlertCommand, { alertId: fixtureAlert.id }, ctx(), ports);
  await executeCommand(
    setAlertRoutingCommand,
    { cells: [{ role: 'viewer', category: 'door', channels: ['in_app'] }] },
    ctx(),
    ports,
  );
  await executeCommand(setMyAlertPhoneCommand, { smsPhone: '+15550100199' }, ctx(), ports);
  await executeCommand(setSalesTargetCommand, { eventId: event.id, tickets: 150 }, ctx(), ports);
  // Batch 3e: a journey step failure reported two days ago (outside the rules' 24-hour window, so
  // it raises nothing), as the alerts subscriber records it (isolation coverage of alerts.signals).
  await withTenant(systemCtx(org.id), (tx) =>
    tx.execute(sql`insert into alerts.signals (org_id, kind, source_event_id, occurred_at)
      values (${org.id}, 'journey_step_failed', ${uuidv7()}, now() - interval '2 days')`),
  );
  // M6.3b: one webhook endpoint (fake publisher), so webhooks.endpoints has rows for both orgs.
  await executeCommand(
    createEndpointCommand,
    { url: `https://hooks.example.com/${slug}`, description: 'Fixture receiver', eventTypes: ['order.paid'] },
    ctx(),
    ports,
  );
  return {
    org,
    ownerId,
    viewerId,
    event,
    apiKey,
    testKey,
    ctx,
    speakerId: speaker.id,
    portal: { accountId: invited.accountId, token: portalSession.token },
  };
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
