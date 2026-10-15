import type { Schemas } from '@yayatoh/sdk';

export type Ticket = Schemas['MyTicket'];
export type Summary = Schemas['MyTicketSummary'];

export const IDS = {
  t1: '11111111-1111-4111-8111-111111111111',
  t2: '22222222-2222-4222-8222-222222222222',
  t3: '33333333-3333-4333-8333-333333333333',
  t4: '44444444-4444-4444-8444-444444444444',
  order: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  event: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  event2: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  type: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  transfer: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

export const FUTURE = { startsAt: '2030-03-01T19:00:00Z', endsAt: '2030-03-01T23:00:00Z' };
export const PAST = { startsAt: '2020-03-01T19:00:00Z', endsAt: '2020-03-01T23:00:00Z' };

export function event(over: Partial<Summary['event']> = {}): Summary['event'] {
  return {
    id: IDS.event,
    slug: 'summer-night',
    name: 'Summer Night',
    status: 'published',
    ...FUTURE,
    timezone: 'America/Chicago',
    venueName: 'Lakeside Pavilion',
    city: 'Chicago',
    country: 'US',
    ...over,
  } as Summary['event'];
}

export function summary(over: Partial<Summary> = {}): Summary {
  return {
    id: IDS.t1,
    orderId: IDS.order,
    status: 'active',
    rev: 1,
    shortCode: 'AB12CD',
    serial: 1,
    holderName: 'Ada Lovelace',
    ticketTypeName: 'General admission',
    seatLabel: null,
    date: null,
    event: event(),
    organizerName: 'Lakeside Events',
    accentColor: '#aa3300',
    pendingTransfer: false,
    ...over,
  };
}

export function ticket(over: Partial<Ticket> = {}): Ticket {
  const base = summary(over);
  return {
    ...base,
    qrCode: 'YY1.SIGNED.CODE.0123456789',
    ticketTypeId: IDS.type,
    checkpoints: [
      { name: 'North gate', kind: 'entrance' },
      { name: 'VIP lounge', kind: 'zone' },
    ],
    venue: {
      name: 'Lakeside Pavilion',
      addressLine1: '1 Lake Shore Dr',
      addressLine2: null,
      city: 'Chicago',
      region: 'IL',
      postalCode: '60601',
      country: 'US',
      latitude: 41.88,
      longitude: -87.62,
      mapUrl: null,
      accessibilityNotes: 'Step-free entrance on the east side.',
    },
    branding: {
      organizerName: 'Lakeside Events',
      logoUrl: 'https://cdn.example.test/logo.png',
      logoAlt: 'Lakeside Events logo',
      accentColor: '#aa3300',
      poweredByVisible: true,
    },
    transfer: {
      allowed: true,
      reason: null,
      deadline: '2030-03-01T17:00:00Z',
      feeMinor: 0,
      currency: 'USD',
      feeRequiresWeb: false,
      pendingTransferId: null,
      pendingTransferTo: null,
    },
    ...over,
  } as Ticket;
}

export const page = (data: Summary[], nextCursor: string | null = null) => ({ data, nextCursor });

export function order(over: Partial<Schemas['MyOrder']> = {}): Schemas['MyOrder'] {
  return {
    id: IDS.order,
    organizerName: 'Lakeside Events',
    event: { slug: 'summer-night', name: 'Summer Night', ...FUTURE, timezone: 'America/Chicago' },
    eventId: IDS.event,
    status: 'paid',
    currency: 'USD',
    subtotalMinor: 10000,
    discountMinor: 0,
    feeMinor: 500,
    totalMinor: 10500,
    paidAt: '2029-12-01T10:00:00Z',
    createdAt: '2029-12-01T10:00:00Z',
    items: [{ ticketTypeId: IDS.type, name: 'General admission', quantity: 2, unitAllInMinor: 5250 }],
    refundPolicy: {
      kind: 'until',
      daysBefore: 7,
      retainedMinor: 100,
      currency: 'USD',
      deadline: '2030-02-22T19:00:00Z',
      timezone: 'America/Chicago',
    },
    refundRequest: { latest: null, canRequest: true, refusal: null, deadline: '2030-02-22T19:00:00Z' },
    ticketIds: [IDS.t1, IDS.t2],
    transferred: 0,
    ...over,
  } as Schemas['MyOrder'];
}

export function claimDetails(over: Partial<Schemas['ClaimDetails']> = {}): Schemas['ClaimDetails'] {
  return {
    state: 'open',
    event: { name: 'Summer Night', ...FUTURE, timezone: 'America/Chicago' },
    ticketTypeName: 'General admission',
    organizerName: 'Lakeside Events',
    transfer: { fromName: 'Grace Hopper', toName: 'Ada Lovelace' },
    ...over,
  } as Schemas['ClaimDetails'];
}
