import type { Schemas } from '@yayatoh/sdk';

export const SLUG = 'summer-jazz';
export const ORDER_ID = '0b9e5a5c-6f0d-4c43-9d57-0d5f3b7d2a11';
export const WEB = 'https://app.yayatoh.test';

export const EVENT: Schemas['PublicEvent'] = {
  attendanceMode: 'in_person',
  category: 'music',
  city: 'Lisbon',
  currency: 'EUR',
  endsAt: '2027-07-10T22:00:00Z',
  name: 'Summer Jazz Night',
  organizerName: 'Blue Note Lisbon',
  profile: 'concert',
  slug: SLUG,
  startsAt: '2027-07-10T19:00:00Z',
  status: 'published',
  tagline: 'Live on the river',
  timezone: 'Europe/Lisbon',
  venueName: 'City Hall',
  venueSlug: 'city-hall',
};

export const pass = (over: Partial<Schemas['PublicTicketType']> = {}): Schemas['PublicTicketType'] => ({
  accessDates: [],
  allInMinor: 2500,
  availability: 'available',
  currency: 'EUR',
  description: null,
  earlyEndsAt: null,
  fewLeft: false,
  id: 'pass-general',
  isDonation: false,
  maxPerOrder: 4,
  minPerOrder: 1,
  name: 'General admission',
  regularAllInMinor: null,
  ...over,
});

export const PASSES: Schemas['PublicTicketType'][] = [
  pass(),
  pass({ id: 'pass-vip', name: 'VIP table', allInMinor: 9000, maxPerOrder: 2, fewLeft: true }),
];

export const summary = (n: number, over: Partial<Schemas['PublicEventSummary']> = {}): Schemas['PublicEventSummary'] => ({
  category: 'music',
  city: 'Lisbon',
  country: 'PT',
  currency: 'EUR',
  distanceKm: null,
  endsAt: '2027-07-10T22:00:00Z',
  maxPriceMinor: 9000,
  minPriceMinor: 2500,
  name: `Event ${n}`,
  organizer: { name: 'Blue Note Lisbon', slug: 'blue-note' },
  profile: 'concert',
  slug: `event-${n}`,
  startsAt: '2027-07-10T19:00:00Z',
  status: 'published',
  tagline: null,
  timezone: 'Europe/Lisbon',
  url: `https://blue-note.yayatoh.test/events/event-${n}`,
  venueName: 'City Hall',
  ...over,
});

export const order = (over: Partial<Schemas['MyOrder']> = {}): Schemas['MyOrder'] => ({
  createdAt: '2027-06-01T10:00:00Z',
  currency: 'EUR',
  discountMinor: 0,
  event: {
    endsAt: EVENT.endsAt,
    name: EVENT.name,
    slug: SLUG,
    startsAt: EVENT.startsAt,
    timezone: EVENT.timezone,
  },
  eventId: 'e1',
  feeMinor: 0,
  id: ORDER_ID,
  items: [{ name: 'General admission', quantity: 2, ticketTypeId: 'pass-general', unitAllInMinor: 2500 }],
  organizerName: 'Blue Note Lisbon',
  paidAt: '2027-06-01T10:01:00Z',
  refundPolicy: null,
  refundRequest: { canRequest: false, deadline: null, latest: null, refusal: null },
  status: 'paid',
  subtotalMinor: 5000,
  ticketIds: ['t1', 't2'],
  totalMinor: 5000,
  transferred: 0,
  ...over,
});

export const orderSummary = (n: number, over: Partial<Schemas['MyOrderSummary']> = {}): Schemas['MyOrderSummary'] => ({
  createdAt: '2027-06-01T10:00:00Z',
  currency: 'EUR',
  endsAt: EVENT.endsAt,
  eventId: 'e1',
  eventName: `Order event ${n}`,
  id: `00000000-0000-4000-8000-00000000000${n}`,
  organizerName: 'Blue Note Lisbon',
  startsAt: EVENT.startsAt,
  status: 'paid',
  tickets: 2,
  timezone: EVENT.timezone,
  totalMinor: 5000,
  ...over,
});
