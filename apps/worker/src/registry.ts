import { agencySnapshotSubscriber } from '@yayatoh/agency';
import { alertEvaluator, connectedConferenceSources } from '@yayatoh/alerts';
import { warehouseFromEnv, warehouseIngestor } from '@yayatoh/analytics';
import { attendeeMessageMailer } from '@yayatoh/attendees';
import { contactSignalsSubscriber, participationProjector } from '@yayatoh/audiences';
import { journeySubscribers } from '@yayatoh/automations';
import { agencyBillingGrantRevoked, billingUsageMeter, nonprofitDiscountFromCharity } from '@yayatoh/billing';
import { campaignsTimeline } from '@yayatoh/campaigns';
import {
  chatReportSignals,
  checkinTimeline,
  checkoutRiskSignals,
  derivedStaffAlerts,
  fraudSignalAlerts,
  networkChatSignals,
  staffAlertsSubscriber,
} from '@yayatoh/checkin';
import { deviceBoardPublisher, publishMetricsChangedTx } from '@yayatoh/command-center';
import {
  giftOutcomesSubscriber,
  giftRefundsSubscriber,
  pledgeMailer,
  pledgeOutcomesSubscriber,
  receiptIssuer,
  statementMailer,
} from '@yayatoh/donations';
import { engagementActivity } from '@yayatoh/engagement';
import { findEventTx, portalInviteMailer } from '@yayatoh/events';
import { registrationResumeMailer } from '@yayatoh/forms';
import { invitationMailer as guestInvitationMailer } from '@yayatoh/guests';
import { listingsProjector } from '@yayatoh/marketplace';
import { programMediaCleaner, speakerPhotoApprover, subjectErasedMediaCleaner } from '@yayatoh/media';
import {
  announcementMailer,
  contactWroteNotifier,
  messagingTimeline,
  threadReplyMailer,
} from '@yayatoh/messaging';
import { createNotifier } from '@yayatoh/notifications';
import {
  creditNoteMailer,
  invoiceMailer,
  orderLinkMailer,
  ordersTimeline,
  postponementMailer,
  refundDeclineMailer,
  refundMailer,
  refundRequestNotifier,
  reminderRescheduler,
  supportReplyMailer,
  tableNamingMailer,
  ticketMailer,
  waitlistMailer,
} from '@yayatoh/orders';
import { agencyCommissionMirror, payoutDestinationMailer } from '@yayatoh/payments';
import { type Subscriber, signLinkToken } from '@yayatoh/platform';
import { defaultResolver } from '@yayatoh/platform/ssrf';
import { erasureConnectorNotifier } from '@yayatoh/privacy';
import { cfpMailer, portalSpeakerCleanup, taskReminderMailer } from '@yayatoh/program';
import {
  decisionMailer,
  enrollmentMailer,
  registrantLifecycle,
  registrationCapacity,
  registrationEnrollment,
  sponsorCompCodes,
} from '@yayatoh/registration';
import { analyticsForwarder, metricsProjector, postgresAnalyticsSink } from '@yayatoh/reports';
import { finderCodeMailer, releaseCancelledSeats } from '@yayatoh/seating';
import { surveyMailer, surveysTimeline } from '@yayatoh/surveys';
import { impersonationNotice, invitationMailer, orgStatusNotice } from '@yayatoh/tenancy';
import {
  claimLinkMailer,
  fakeWalletPassProvider,
  holderLinkMailer,
  ticketCancelledMailer,
  ticketResendMailer,
  transferMailer,
  walletPassSync,
} from '@yayatoh/ticketing';
import { configureWebhooks, webhookPublisherFromEnv, webhookPublisherSubscriber } from '@yayatoh/webhooks';
import { z } from 'zod';
import { contactStatsJob } from './contact-stats.ts';
import { duplicateScanJob } from './duplicates.ts';
import { syncJob } from './integrations.ts';
import { defineJob } from './jobs.ts';
import { journeyJob } from './journeys.ts';

export const heartbeat = defineJob({
  name: 'platform.heartbeat',
  scope: 'platform',
  payload: z.object({ at: z.iso.datetime() }),
  handler: async () => {},
});

/** Composition root for jobs and event subscribers. Modules register theirs here as they land. */
// M6.4a: integration syncs (the fake port in dev/CI; off in production until Nango is configured).
export const JOBS = [heartbeat, journeyJob(), duplicateScanJob(), contactStatsJob(), syncJob()] as const;
export function subscribers(env: NodeJS.ProcessEnv = process.env): Subscriber[] {
  const secret = env.APP_TOKEN_SECRET;
  const appOrigin = env.NEXT_PUBLIC_APP_ORIGIN;
  if (!secret || !appOrigin)
    throw new Error('APP_TOKEN_SECRET and NEXT_PUBLIC_APP_ORIGIN are required by the worker');
  // Subscribers queue messages; the notifications dispatcher sends them (main.ts).
  const notifier = createNotifier();
  // M6.3b: outbound webhooks (Svix, or the fake outside production until the owner's account).
  const webhooks = webhookPublisherFromEnv(env, appOrigin);
  configureWebhooks({ publisher: webhooks, resolver: defaultResolver });
  return [
    invitationMailer({ notifier, appOrigin, secret }),
    ticketMailer({ notifier, appOrigin }),
    orderLinkMailer({ notifier, appOrigin }),
    refundMailer({ notifier, appOrigin }),
    refundRequestNotifier({ notifier }),
    refundDeclineMailer({ notifier, appOrigin }),
    postponementMailer({ notifier, appOrigin }),
    reminderRescheduler(),
    claimLinkMailer({ notifier, appOrigin }),
    holderLinkMailer({ notifier, appOrigin }),
    ticketResendMailer({ notifier, appOrigin }),
    ticketCancelledMailer({ notifier }),
    // M3.10c support tools: transfers (claim link, then both sides), wallet passes (fake provider
    // until the owner's Apple/Google accounts), credit notes, macro replies, dispute deadlines.
    transferMailer({ notifier, appOrigin }),
    walletPassSync({ provider: fakeWalletPassProvider() }),
    creditNoteMailer({ notifier, appOrigin }),
    // M5.1d: pay-later invoices.
    invoiceMailer({ notifier, appOrigin }),
    supportReplyMailer({ notifier, appOrigin }),
    // Dispute evidence deadlines reach finance through the alert engine (batch 3e: the
    // `disputeDeadline` rule), not a second notification.
    attendeeMessageMailer({ notifier, event: findEventTx }),
    announcementMailer({ notifier, appOrigin }),
    threadReplyMailer({ notifier, appOrigin }),
    contactWroteNotifier({ notifier }),
    releaseCancelledSeats(),
    payoutDestinationMailer({ notifier, appOrigin }),
    impersonationNotice({ notifier, appOrigin }),
    orgStatusNotice({ notifier, appOrigin }),
    finderCodeMailer({ notifier, appOrigin }),
    // M1.9e: checkout risk outcomes and chat reports become fraud signals; high ones alert.
    checkoutRiskSignals(),
    chatReportSignals(),
    // M5.8b: networking chat reports about attendees.
    networkChatSignals(),
    fraudSignalAlerts({ notifier }),
    // M3.4a: staff alerts for the Scan PWA (web push per device). The Command Center alert engine
    // (M3.2b) replaces `derivedStaffAlerts` here and in apps/web/src/server/scan-staff.ts.
    staffAlertsSubscriber(derivedStaffAlerts),
    programMediaCleaner(),
    // M6.1c: an erasure's stored files, then the connector hooks (M6.4), after it committed.
    subjectErasedMediaCleaner(),
    erasureConnectorNotifier(),
    // M5.3a speaker portal: invitations, task reminders, approved photos.
    portalInviteMailer({ notifier, appOrigin }),
    taskReminderMailer({ notifier, appOrigin }),
    cfpMailer({ notifier }),
    speakerPhotoApprover(),
    portalSpeakerCleanup(),
    surveyMailer({ notifier, appOrigin }),
    // M4.1f: wedding invitations by email and text (the reminders run on the journey job).
    guestInvitationMailer({ notifier, appOrigin }),
    registrationResumeMailer({
      notifier,
      appOrigin,
      eventName: async (tx, id) => (await findEventTx(tx, id))?.name ?? null,
    }),
    waitlistMailer({ notifier, appOrigin }),
    // M4.2b: a purchased table's claim link to its buyer.
    tableNamingMailer({ notifier, appOrigin }),
    // M3.7a: journeys enroll on purchase and check-in, follow date changes and cancellations.
    ...journeySubscribers(),
    // M5.1a: per-type capacity follows orders (paid, expired, refunded, cancelled) and offers freed places.
    registrationCapacity(),
    // M5.1c: registrants follow their orders; approval and denial emails.
    registrantLifecycle(),
    decisionMailer({ notifier, appOrigin }),
    // M5.2b: cancelled registrants give their session places back; promotions are emailed.
    registrationEnrollment(),
    enrollmentMailer({ notifier, appOrigin }),
    // M5.4b: sponsor comp registration codes.
    sponsorCompCodes(),
    // M3.6a: contact × event participation and contact profiles for audiences.
    participationProjector(),
    // M6.1a: the person timeline (crm projection), fed by each owning module.
    ...timelineSubscribers(),
    // M6.1b: sessions attended and campaigns opened feed the contact stats.
    contactSignalsSubscriber(),
    // M5.7b: door scans, answered surveys and enrollments become engagement (scores for audiences).
    engagementActivity(),
    listingsProjector({ onChange: (orgId) => revalidatePublicCache(appOrigin, orgId, secret) }),
    // M3.1: metric snapshots and time series, and the analytics sink (Postgres until M6.2).
    // M3.2: each projected change pings the event's Command Center (no figures on the channel).
    metricsProjector({
      onChange: async (orgId, eventId, tx) => {
        if (eventId) await publishMetricsChangedTx(tx, orgId, eventId, new Date());
      },
    }),
    analyticsForwarder(postgresAnalyticsSink),
    // M6.2a: the analytics warehouse (Postgres rollups, or Tinybird with ANALYTICS_WAREHOUSE).
    warehouseIngestor(warehouseFromEnv(env)),
    // M3.2: device presence for the Command Center's device widgets (events in pre-show or live).
    deviceBoardPublisher(),
    // M3.2b: the alert engine re-evaluates what each outbox event touched (sends through notifications).
    alertEvaluator({ notifier, conference: connectedConferenceSources }),
    // M4.8a: gift orders' outcomes (paid, failed, lapsed) move their gifts.
    giftOutcomesSubscriber,
    giftRefundsSubscriber,
    // M4.8b: a receipt per paid gift or charity-ticket order, and year-end statements, to the donor.
    receiptIssuer({ notifier, appOrigin }),
    statementMailer({ notifier, appOrigin }),
    // M6.3b: public outbox events to the org's webhook endpoints (thin payloads, catalog only).
    webhookPublisherSubscriber({ publisher: () => webhooks }),
    // M4.8e: pledge payments settle their pledges; the donor's summary, invoice and reminders.
    pledgeOutcomesSubscriber,
    pledgeMailer({ notifier, appOrigin }),
    // M6.7a: a client's grant snapshots it for its agency at once (and a revoke removes it).
    agencySnapshotSubscriber,
    // M6.8a: agency commission mirrored into the agency's ledger; a revoked grant ends agency billing.
    agencyCommissionMirror,
    agencyBillingGrantRevoked,
    // M6.6b: the billing meters (messaging, AI credits, devices) count usage from the outbox, and a
    // verified charity profile gives the org the nonprofit discount.
    billingUsageMeter(),
    nonprofitDiscountFromCharity(),
  ];
}

/** M6.1a: the modules that write the person timeline (the web's dev drain runs the same list). */
export function timelineSubscribers(): Subscriber[] {
  return [ordersTimeline(), checkinTimeline(), messagingTimeline(), surveysTimeline(), campaignsTimeline()];
}

/**
 * Ask the web app to drop an org's cached public pages (and the marketplace's) after its
 * listings changed. Signed per org with APP_TOKEN_SECRET; failures only log (the cache TTL
 * catches up within seconds).
 */
export async function revalidatePublicCache(appOrigin: string, orgId: string, secret: string): Promise<void> {
  try {
    const res = await fetch(`${appOrigin}/api/internal/revalidate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: signLinkToken('cache.revalidate', orgId, secret) }),
    });
    if (!res.ok) console.warn(`revalidate ${orgId}: ${res.status}`);
  } catch (err) {
    console.warn(`revalidate ${orgId}: ${(err as Error).message}`);
  }
}
