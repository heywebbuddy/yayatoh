import type { MessageKind } from '../kinds.ts';

/** Sample params per kind: previews in the console and the 13-locale snapshot tests. */
export const SAMPLE_PARAMS: Readonly<Record<MessageKind, Readonly<Record<string, string | number>>>> = {
  'orders.tickets': {
    url: 'https://app.yayatoh.test/orders/sample',
    name: 'Amina Diallo',
    eventName: 'Lakeside Jazz Night',
    count: 2,
  },
  'orders.refund': {
    url: 'https://app.yayatoh.test/orders/sample',
    name: 'Amina Diallo',
    eventName: 'Lakeside Jazz Night',
    amountMinor: 4500,
    currency: 'USD',
    fully: 'no',
  },
  'events.reminder': {
    url: 'https://app.yayatoh.test/orders/sample',
    name: 'Amina Diallo',
    eventName: 'Lakeside Jazz Night',
    startsAt: '2027-06-12T23:30:00.000Z',
    timeZone: 'America/Chicago',
    venue: 'Harbor Hall',
  },
  'tenancy.invitation': {
    url: 'https://app.yayatoh.test/invite/sample',
    role: 'manager',
    orgName: 'Lakeside Events',
  },
  'ticketing.claim-link': { url: 'https://app.yayatoh.test/claim/sample', eventName: 'Lakeside Jazz Night' },
  'ticketing.holder-link': {
    url: 'https://app.yayatoh.test/my-tickets/sample',
    eventName: 'Lakeside Jazz Night',
  },
  'seating.finder-code': {
    code: '482913',
    eventName: 'Lakeside Jazz Night',
    url: 'https://app.yayatoh.test/events/lakeside-jazz-night/seat-finder',
    minutes: 10,
  },
  'attendees.message': {
    subject: 'Parking update',
    body: 'Lot B is closed tonight.\nPlease use Lot C on Harbor Street.',
    name: 'Amina Diallo',
    eventName: 'Lakeside Jazz Night',
  },
  'messaging.announcement': {
    subject: 'Doors open at 7',
    body: 'We open doors 30 minutes early.\n\nSee you soon!',
    name: 'Amina Diallo',
    eventName: 'Lakeside Jazz Night',
    replyUrl: 'https://app.yayatoh.test/messages/sample',
  },
  'messaging.reply': {
    body: 'Yes, the venue is step-free.',
    name: 'Amina Diallo',
    replyUrl: 'https://app.yayatoh.test/messages/sample',
  },
  'sales.order_paid': {
    name: 'Amina Diallo',
    eventName: 'Lakeside Jazz Night',
    count: 2,
    amountMinor: 9000,
    currency: 'USD',
  },
  'messaging.contact_replied': { name: 'Amina Diallo', eventName: 'Lakeside Jazz Night' },
  'payments.destination-changed': {
    url: 'https://app.yayatoh.test/o/lakeside-events/payouts',
    reason: 'connected',
    holdUntil: '2027-06-13T15:00:00.000Z',
    timeZone: 'America/Chicago',
  },
  'notifications.test': {},
};
