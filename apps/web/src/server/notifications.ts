import 'server-only';
import { alertEvaluator, evaluateOrgNow, watchQuietDevices } from '@yayatoh/alerts';
import { attendeeMessageMailer } from '@yayatoh/attendees';
import { getUsersByIds } from '@yayatoh/auth';
import { journeySubscribers, runDueActions } from '@yayatoh/automations';
import {
  chatReportSignals,
  checkoutRiskSignals,
  fraudSignalAlerts,
  sendStaffAlertPushes,
  staffAlertsSubscriber,
} from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { findEventTx, portalInviteMailer } from '@yayatoh/events';
import { registrationResumeMailer } from '@yayatoh/forms';
import { createCtx } from '@yayatoh/kernel';
import { announcementMailer, contactWroteNotifier, threadReplyMailer } from '@yayatoh/messaging';
import {
  createNotifier,
  type DispatchDeps,
  devMailboxTransports,
  dispatchDue,
  FAKE_DELIVERY_SIGNATURE_HEADER,
  fakeDeliverySecret,
  handleProviderWebhook,
  takeDevDeliveryEvents,
  withWebPush,
} from '@yayatoh/notifications';
import {
  creditNoteMailer,
  orderLinkMailer,
  postponementMailer,
  refundDeclineMailer,
  refundMailer,
  refundRequestNotifier,
  reminderRescheduler,
  supportReplyMailer,
  ticketMailer,
  waitlistMailer,
} from '@yayatoh/orders';
import { payoutDestinationMailer } from '@yayatoh/payments';
import {
  consumeEvent,
  processedPairsTx,
  recentEventsTx,
  type Subscriber,
  subscribes,
} from '@yayatoh/platform';
import { taskReminderMailer } from '@yayatoh/program';
import { registrationCapacity, sponsorCompCodes } from '@yayatoh/registration';
import { surveyMailer } from '@yayatoh/surveys';
import { impersonationNotice, invitationMailer, orgStatusNotice } from '@yayatoh/tenancy';
import {
  claimLinkMailer,
  fakeWalletPassProvider,
  holderLinkMailer,
  ticketResendMailer,
  transferMailer,
  walletPassSync,
} from '@yayatoh/ticketing';
import { webhookAdapter } from './delivery-webhooks.ts';
// The composition root registers the key vault (message params and manage links are encrypted).
import { ports } from './ports.ts';
import { staffAlertSource, staffPushSender } from './scan-staff.ts';
import { webPushConfig } from './web-push.ts';

export const notifier = createNotifier();

/** The fake wallet pass provider in dev and CI (M3.10c): what it was told stays in memory. */
export const devWalletPasses = fakeWalletPassProvider();

export const userEmails: NonNullable<DispatchDeps['userEmails']> = async (ids) =>
  new Map([...(await getUsersByIds(ids))].map(([id, u]) => [id, u.email]));

/** Members' email languages (M1.10d): member notifications render in them. */
export const userLocales: NonNullable<DispatchDeps['userLocales']> = async (ids) =>
  new Map([...(await getUsersByIds(ids))].map(([id, u]) => [id, u.locale]));

/** The message-producing subscribers, composed like the worker's (apps/worker/src/registry.ts). */
function messageSubscribers(appOrigin: string): Subscriber[] {
  const secret = process.env.APP_TOKEN_SECRET ?? '';
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
    // M3.10c support tools (as in the worker).
    ticketResendMailer({ notifier, appOrigin }),
    transferMailer({ notifier, appOrigin }),
    walletPassSync({ provider: devWalletPasses }),
    creditNoteMailer({ notifier, appOrigin }),
    supportReplyMailer({ notifier, appOrigin }),
    // Dispute evidence deadlines reach finance through the alert engine (batch 3e: the
    // `disputeDeadline` rule), not a second notification.
    attendeeMessageMailer({ notifier, event: findEventTx }),
    announcementMailer({ notifier, appOrigin }),
    threadReplyMailer({ notifier, appOrigin }),
    contactWroteNotifier({ notifier }),
    payoutDestinationMailer({ notifier, appOrigin }),
    impersonationNotice({ notifier, appOrigin }),
    orgStatusNotice({ notifier, appOrigin }),
    checkoutRiskSignals(),
    chatReportSignals(),
    fraudSignalAlerts({ notifier }),
    // M3.4a: staff alerts for the Scan PWA (web push per device).
    staffAlertsSubscriber(staffAlertSource),
    surveyMailer({ notifier, appOrigin }),
    registrationResumeMailer({
      notifier,
      appOrigin,
      eventName: async (tx, id) => (await findEventTx(tx, id))?.name ?? null,
    }),
    waitlistMailer({ notifier, appOrigin }),
    alertEvaluator({ notifier }),
    // M3.7a: journeys enroll, follow date changes and cancellations (their steps run below).
    ...journeySubscribers(),
    // M5.1a: its offers (waitlist.offered) are mailed in the same drain.
    registrationCapacity(),
    // M5.4b: sponsor comp registration codes.
    sponsorCompCodes(),
    // M5.3a speaker portal: invitations and task reminders.
    portalInviteMailer({ notifier, appOrigin }),
    taskReminderMailer({ notifier, appOrigin }),
  ];
}

/**
 * Development and CI only (the /api/dev/outbox/drain route): run this org's recent message
 * events through the same subscribers the worker runs, then send what is due to the dev mailbox,
 * including messages held for quiet hours (and, with `scheduled`, reminders not yet due). The
 * fake provider's delivery reports for what was sent then go through the webhook path (verified,
 * deduplicated), so bounces and complaints reach the log and the suppression list. Exactly-once
 * still holds: consumers dedupe through processed_events and deliveries through their dedupe keys,
 * so a real worker running at the same time changes nothing.
 */
export async function drainOrgMessages(
  orgId: string,
  appOrigin: string,
  opts: { scheduled?: boolean; sweep?: boolean } = {},
) {
  const subs = messageSubscribers(appOrigin);
  const types = [...new Set(subs.flatMap((s) => s.events.map((e) => e.split('@')[0] as string)))];
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'dev.drain' } });
  let consumed = 0;
  // Subscribers may emit events other subscribers consume (fraud signals → alerts, M1.9e): run
  // until a pass consumes nothing new (bounded).
  let journeySteps = 0;
  for (let pass = 0; pass < 4; pass++) {
    const events = await withTenant(ctx, (tx) => recentEventsTx(tx, orgId, types, 6 * 3600_000));
    // What each subscriber already handled, in one read (batch 3g merge: one transaction per
    // event and subscriber made drains of the shared e2e org slow); consumeEvent still guards.
    const done = await withTenant(ctx, (tx) =>
      processedPairsTx(
        tx,
        subs.map((s) => s.name),
        events.map((e) => e.id),
      ),
    );
    let fresh = 0;
    for (const event of events) {
      for (const s of subs)
        if (subscribes(s, event) && !done.has(`${s.name}|${event.id}`) && (await consumeEvent(s, event)))
          fresh += 1;
    }
    consumed += fresh;
    // Journey steps due now (M3.7a; the worker's `automations.run-due` job): they queue messages
    // and may emit events (a survey step's `survey.sent`), so the next pass picks those up.
    const steps = await runDueActions(orgId, { notifier }, ports);
    journeySteps += steps.done + steps.skipped + steps.failed;
    if (fresh === 0 && steps.done === 0) break;
  }
  // The live device watchdog (M3.3a), as the worker would run it now. Unless the org-wide pass
  // follows anyway, it evaluates the events the quiet devices were working at (not every event of
  // the org: in the shared e2e org that slowed every drain, batch 3g merge).
  await watchQuietDevices(orgId, { notifier }, { evaluate: opts.sweep ? false : 'devices' });
  // The alert engine's scheduled pass (M3.2b), as the worker's sweep would run it now: only when
  // asked (`sweep`). The alerts evaluator above already re-evaluates what the drained events
  // touched; the org-wide pass re-checks every upcoming event and re-notifies unacknowledged
  // alerts, which in a shared e2e org (hundreds of events, never acknowledged) made every other
  // suite's drain dispatch that backlog (batch 3d merge).
  if (opts.sweep) await evaluateOrgNow(orgId, { notifier });
  const deps: DispatchDeps = {
    // Web push goes through the real adapter (VAPID + aes128gcm); in dev/CI the only endpoints
    // it may reach besides real push services are the fake push service on this origin.
    transports: withWebPush(devMailboxTransports(undefined, { deliverySecret: fakeDeliverySecret() }), {
      vapid: webPushConfig(),
      appOrigin,
      fakeOrigin: appOrigin,
    }),
    appOrigin,
    userEmails,
    userLocales,
    ignoreQuietHours: true,
    includeScheduled: opts.scheduled === true,
  };
  let sent = 0;
  for (let i = 0; i < 10; i++) {
    const r = await dispatchDue(orgId, deps, 100);
    sent += r.sent;
    if (r.sent + r.suppressed + r.failed === 0) break;
  }
  // Staff alert pushes (M3.4a), through the same web push adapter.
  const staffSender = staffPushSender(appOrigin);
  if (staffSender) sent += (await sendStaffAlertPushes(orgId, staffSender)).sent;
  let reports = 0;
  // The fake provider's reports go through the same webhook pipeline (verified, deduplicated,
  // counted in provider health) as a real provider's.
  const adapter = webhookAdapter('email', 'fake');
  if (adapter)
    for (const d of takeDevDeliveryEvents()) {
      const out = await handleProviderWebhook(
        adapter,
        {
          rawBody: d.body,
          headers: new Headers({ [FAKE_DELIVERY_SIGNATURE_HEADER]: d.signature }),
          url: `${appOrigin}/api/webhooks/email/fake`,
        },
        ports,
      );
      reports += out.result?.recorded ?? 0;
    }
  return { consumed, journeySteps, sent, reports };
}
