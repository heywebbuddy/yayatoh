import { attendeeMessageMailer } from '@yayatoh/attendees';
import { getUsersByIds } from '@yayatoh/auth';
import { findEventTx } from '@yayatoh/events';
import { listingsProjector } from '@yayatoh/marketplace';
import { announcementMailer, contactWroteNotifier, threadReplyMailer } from '@yayatoh/messaging';
import { createNotifier } from '@yayatoh/notifications';
import { refundMailer, ticketMailer } from '@yayatoh/orders';
import { payoutDestinationMailer } from '@yayatoh/payments';
import { type Subscriber, signLinkToken } from '@yayatoh/platform';
import { finderCodeMailer, releaseCancelledSeats } from '@yayatoh/seating';
import { invitationMailer } from '@yayatoh/tenancy';
import { claimLinkMailer, holderLinkMailer } from '@yayatoh/ticketing';
import { z } from 'zod';
import { defineJob } from './jobs.ts';

export const heartbeat = defineJob({
  name: 'platform.heartbeat',
  scope: 'platform',
  payload: z.object({ at: z.iso.datetime() }),
  handler: async () => {},
});

/** Composition root for jobs and event subscribers. Modules register theirs here as they land. */
export const JOBS = [heartbeat] as const;
export function subscribers(env: NodeJS.ProcessEnv = process.env): Subscriber[] {
  const secret = env.APP_TOKEN_SECRET;
  const appOrigin = env.NEXT_PUBLIC_APP_ORIGIN;
  if (!secret || !appOrigin)
    throw new Error('APP_TOKEN_SECRET and NEXT_PUBLIC_APP_ORIGIN are required by the worker');
  // Subscribers queue messages; the notifications dispatcher sends them (main.ts).
  const notifier = createNotifier();
  return [
    invitationMailer({ notifier, appOrigin, secret }),
    ticketMailer({ notifier, appOrigin }),
    refundMailer({ notifier, appOrigin }),
    claimLinkMailer({ notifier, appOrigin }),
    holderLinkMailer({ notifier, appOrigin }),
    attendeeMessageMailer({ notifier, event: findEventTx }),
    announcementMailer({ notifier, appOrigin }),
    threadReplyMailer({ notifier, appOrigin }),
    contactWroteNotifier({ notifier }),
    releaseCancelledSeats(),
    // TODO(M1.2c): port to the notifier (M1.10 retired the platform Mailer).
    payoutDestinationMailer({ notifier, appOrigin }),
    finderCodeMailer({ notifier, appOrigin }),
    listingsProjector({ onChange: (orgId) => revalidatePublicCache(appOrigin, orgId, secret) }),
  ];
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
