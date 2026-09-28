import 'server-only';
import { attendeeMessageMailer } from '@yayatoh/attendees';
import { getUsersByIds } from '@yayatoh/auth';
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
  takeDevDeliveryEvents,
  withWebPush,
} from '@yayatoh/notifications';
import { refundMailer, reminderRescheduler, ticketMailer } from '@yayatoh/orders';
import { payoutDestinationMailer } from '@yayatoh/payments';
import { consumeEvent, eventKey, recentEventsTx, type Subscriber } from '@yayatoh/platform';
import { invitationMailer } from '@yayatoh/tenancy';
import { claimLinkMailer, holderLinkMailer } from '@yayatoh/ticketing';
// The composition root registers the key vault (message params and manage links are encrypted).
import './ports.ts';
import { deliveryAdapter, ingestDeliveryEvents } from './delivery-webhooks.ts';
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
    refundMailer({ notifier, appOrigin }),
    reminderRescheduler(),
    claimLinkMailer({ notifier, appOrigin }),
    holderLinkMailer({ notifier, appOrigin }),
    attendeeMessageMailer({ notifier, event: findEventTx }),
    announcementMailer({ notifier, appOrigin }),
    threadReplyMailer({ notifier, appOrigin }),
    contactWroteNotifier({ notifier }),
    payoutDestinationMailer({ notifier, appOrigin }),
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
  const events = await withTenant(ctx, (tx) => recentEventsTx(tx, orgId, types, 6 * 3600_000));
  let consumed = 0;
  for (const event of events) {
    for (const s of subs)
      if (s.events.includes(eventKey(event)) && (await consumeEvent(s, event))) consumed += 1;
  }
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
  let reports = 0;
  const adapter = deliveryAdapter('fake');
  if (adapter)
    for (const d of takeDevDeliveryEvents()) {
      const verified = adapter.verify(d.body, new Headers({ [FAKE_DELIVERY_SIGNATURE_HEADER]: d.signature }));
      reports += (await ingestDeliveryEvents(adapter.name, verified)).recorded;
    }
  return { consumed, sent, reports };
}
