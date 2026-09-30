import 'server-only';
import { alertEvaluator, evaluateOrgNow, watchQuietDevices } from '@yayatoh/alerts';
import { attendeeMessageMailer } from '@yayatoh/attendees';
import { getUsersByIds } from '@yayatoh/auth';
import {
  chatReportSignals,
  checkoutRiskSignals,
  fraudSignalAlerts,
  sendStaffAlertPushes,
  staffAlertsSubscriber,
} from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
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
  orderLinkMailer,
  postponementMailer,
  refundDeclineMailer,
  refundMailer,
  refundRequestNotifier,
  reminderRescheduler,
  ticketMailer,
  waitlistMailer,
} from '@yayatoh/orders';
import { payoutDestinationMailer } from '@yayatoh/payments';
import { consumeEvent, recentEventsTx, type Subscriber, subscribes } from '@yayatoh/platform';
import { surveyMailer } from '@yayatoh/surveys';
import { impersonationNotice, invitationMailer, orgStatusNotice } from '@yayatoh/tenancy';
import { claimLinkMailer, holderLinkMailer } from '@yayatoh/ticketing';
import { webhookAdapter } from './delivery-webhooks.ts';
// The composition root registers the key vault (message params and manage links are encrypted).
import { ports } from './ports.ts';
import { staffAlertSource, staffPushSender } from './scan-staff.ts';
import { webPushConfig } from './web-push.ts';

export const notifier = createNotifier();

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
    waitlistMailer({ notifier, appOrigin }),
    alertEvaluator({ notifier }),
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
export async function drainOrgMessages(orgId: string, appOrigin: string, opts: { scheduled?: boolean } = {}) {
  const subs = messageSubscribers(appOrigin);
  const types = [...new Set(subs.flatMap((s) => s.events.map((e) => e.split('@')[0] as string)))];
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'dev.drain' } });
  let consumed = 0;
  // Subscribers may emit events other subscribers consume (fraud signals → alerts, M1.9e): run
  // until a pass consumes nothing new (bounded).
  for (let pass = 0; pass < 3; pass++) {
    const events = await withTenant(ctx, (tx) => recentEventsTx(tx, orgId, types, 6 * 3600_000));
    let fresh = 0;
    for (const event of events) {
      for (const s of subs) if (subscribes(s, event) && (await consumeEvent(s, event))) fresh += 1;
    }
    consumed += fresh;
    if (fresh === 0) break;
  }
  // The live device watchdog (M3.3a) and the alert engine's scheduled pass (M3.2b), as the
  // worker would run them now.
  await watchQuietDevices(orgId, { notifier }, { evaluate: false });
  await evaluateOrgNow(orgId, { notifier });
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
  return { consumed, sent, reports };
}
