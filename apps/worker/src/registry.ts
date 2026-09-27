import { attendeeMessageMailer } from '@yayatoh/attendees';
import { findEventTx } from '@yayatoh/events';
import { ticketMailer } from '@yayatoh/orders';
import { consoleMailer, type Subscriber } from '@yayatoh/platform';
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
  // consoleMailer until SES exists (M1.10, owner account pending).
  return [
    invitationMailer({ mailer: consoleMailer, appOrigin, secret }),
    ticketMailer({ mailer: consoleMailer, appOrigin }),
    claimLinkMailer({ mailer: consoleMailer, appOrigin }),
    holderLinkMailer({ mailer: consoleMailer, appOrigin }),
    attendeeMessageMailer({
      mailer: consoleMailer,
      eventName: async (tx, id) => (await findEventTx(tx, id))?.name ?? null,
    }),
    releaseCancelledSeats(),
  ];
}
