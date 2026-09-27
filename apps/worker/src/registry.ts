import { attendeeMessageMailer } from '@yayatoh/attendees';
import { findEventTx } from '@yayatoh/events';
import { announcementMailer, contactWroteNotifier, threadReplyMailer } from '@yayatoh/messaging';
import { createNotifier } from '@yayatoh/notifications';
import { refundMailer, ticketMailer } from '@yayatoh/orders';
import type { Subscriber } from '@yayatoh/platform';
import { releaseCancelledSeats } from '@yayatoh/seating';
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
  ];
}
