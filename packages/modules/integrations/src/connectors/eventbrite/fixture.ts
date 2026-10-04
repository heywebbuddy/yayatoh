/**
 * The recorded Eventbrite fixture account (M6.4b): the shapes the Eventbrite API v3 answers for
 * an organization's events (`expand=ticket_classes,venue`) and orders (`expand=attendees`),
 * trimmed to the fields the importer reads. Invented people and events (`.test` addresses); no
 * real account. The fake provider (`fake.ts`) serves it page by page, and `EVENTBRITE_FIXTURE_COUNTS`
 * is what an import into a fresh org must reproduce.
 */

const money = (currency: string, value: number) => ({
  currency,
  value,
  major_value: (value / 100).toFixed(2),
  display: `${currency} ${(value / 100).toFixed(2)}`,
});

const when = (timezone: string, utc: string, local: string) => ({ timezone, utc, local });

export interface EbTicketClass {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  free: boolean;
  cost: ReturnType<typeof money> | null;
  quantity_total: number;
  quantity_sold: number;
  hidden: boolean;
  sales_start: string | null;
  sales_end: string | null;
}

export interface EbEvent {
  id: string;
  name: { text: string; html: string };
  description: { text: string | null };
  start: ReturnType<typeof when>;
  end: ReturnType<typeof when>;
  currency: string;
  status: 'draft' | 'live' | 'started' | 'ended' | 'completed' | 'canceled';
  online_event: boolean;
  created: string;
  changed: string;
  venue: { name: string; address: { city: string | null; country: string | null } } | null;
  ticket_classes: EbTicketClass[];
}

export interface EbAttendee {
  id: string;
  order_id: string;
  event_id: string;
  ticket_class_id: string;
  profile: { name: string; first_name: string; last_name: string; email: string };
  costs: {
    base_price: ReturnType<typeof money>;
    eventbrite_fee: ReturnType<typeof money>;
    payment_fee: ReturnType<typeof money>;
    tax: ReturnType<typeof money>;
    gross: ReturnType<typeof money>;
  };
  status: 'Attending' | 'Not Attending' | 'Checked In';
  cancelled: boolean;
  refunded: boolean;
}

export interface EbOrder {
  id: string;
  event_id: string;
  created: string;
  changed: string;
  status: 'placed' | 'refunded' | 'deleted';
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  costs: {
    base_price: ReturnType<typeof money>;
    eventbrite_fee: ReturnType<typeof money>;
    payment_fee: ReturnType<typeof money>;
    tax: ReturnType<typeof money>;
    gross: ReturnType<typeof money>;
  };
  attendees: EbAttendee[];
}

export const EB_ORGANIZATION = { id: '2468013579', name: 'Lakeside Arts on Eventbrite' };

const tc = (
  event_id: string,
  id: string,
  name: string,
  currency: string,
  price: number,
  total: number,
  sold: number,
  extra: Partial<EbTicketClass> = {},
): EbTicketClass => ({
  id,
  event_id,
  name,
  description: null,
  free: price === 0,
  cost: price === 0 ? null : money(currency, price),
  quantity_total: total,
  quantity_sold: sold,
  hidden: false,
  sales_start: null,
  sales_end: null,
  ...extra,
});

export const EB_EVENTS: readonly EbEvent[] = [
  {
    id: '710001',
    name: { text: 'Summer Jazz Night', html: 'Summer Jazz Night' },
    description: { text: 'An evening of jazz by the lake.' },
    start: when('America/Chicago', '2026-07-18T23:00:00Z', '2026-07-18T18:00:00'),
    end: when('America/Chicago', '2026-07-19T03:00:00Z', '2026-07-18T22:00:00'),
    currency: 'USD',
    status: 'completed',
    online_event: false,
    created: '2026-04-02T15:00:00Z',
    changed: '2026-07-20T09:00:00Z',
    venue: { name: 'Lakeside Pavilion', address: { city: 'Madison', country: 'US' } },
    ticket_classes: [
      tc('710001', '9100011', 'General admission', 'USD', 2500, 200, 3),
      tc('710001', '9100012', 'VIP lounge', 'USD', 6000, 20, 1),
      tc('710001', '9100013', 'Student (free)', 'USD', 0, 50, 3, { description: 'Bring a student ID.' }),
    ],
  },
  {
    id: '710002',
    name: { text: 'Rivers of Europe: a lecture', html: 'Rivers of Europe: a lecture' },
    description: { text: null },
    start: when('Europe/Berlin', '2026-11-12T18:30:00Z', '2026-11-12T19:30:00'),
    end: when('Europe/Berlin', '2026-11-12T20:30:00Z', '2026-11-12T21:30:00'),
    currency: 'EUR',
    status: 'live',
    online_event: false,
    created: '2026-08-01T10:00:00Z',
    changed: '2026-09-15T08:00:00Z',
    venue: { name: 'Haus am Fluss', address: { city: 'Berlin', country: 'DE' } },
    ticket_classes: [
      tc('710002', '9100021', 'Standard', 'EUR', 1550, 120, 3),
      tc('710002', '9100022', 'Supporter', 'EUR', 4000, 30, 1, { hidden: true }),
    ],
  },
  {
    id: '710003',
    name: { text: 'Winter Gala 2026', html: 'Winter Gala 2026' },
    description: { text: 'Black tie optional.' },
    start: when('America/New_York', '2026-12-05T00:00:00Z', '2026-12-04T19:00:00'),
    end: when('America/New_York', '2026-12-05T05:00:00Z', '2026-12-05T00:00:00'),
    currency: 'USD',
    status: 'live',
    online_event: false,
    created: '2026-08-20T12:00:00Z',
    changed: '2026-09-28T12:00:00Z',
    venue: { name: 'The Grand Hall', address: { city: 'New York', country: 'US' } },
    ticket_classes: [tc('710003', '9100031', 'Gala dinner', 'USD', 12500, 300, 3)],
  },
];

const classOf = (id: string): EbTicketClass => {
  for (const e of EB_EVENTS) for (const c of e.ticket_classes) if (c.id === id) return c;
  throw new Error(`fixture: unknown ticket class ${id}`);
};

/** An attendee whose fee is `fee` (Eventbrite's fee; payment fee and tax 0 in this account). */
const att = (
  order: { id: string; event_id: string },
  n: number,
  classId: string,
  name: string,
  email: string,
  fee: number,
  extra: Partial<EbAttendee> = {},
): EbAttendee => {
  const c = classOf(classId);
  const currency = c.cost?.currency ?? EB_EVENTS.find((e) => e.id === order.event_id)?.currency ?? 'USD';
  const base = c.cost?.value ?? 0;
  const [first = name, ...rest] = name.split(' ');
  return {
    id: `${order.id}0${n}`,
    order_id: order.id,
    event_id: order.event_id,
    ticket_class_id: classId,
    profile: { name, first_name: first, last_name: rest.join(' '), email },
    costs: {
      base_price: money(currency, base),
      eventbrite_fee: money(currency, fee),
      payment_fee: money(currency, 0),
      tax: money(currency, 0),
      gross: money(currency, base + fee),
    },
    status: 'Attending',
    cancelled: false,
    refunded: false,
    ...extra,
  };
};

function order(
  id: string,
  event_id: string,
  created: string,
  buyer: { name: string; email: string },
  attendees: (o: { id: string; event_id: string }) => EbAttendee[],
  status: EbOrder['status'] = 'placed',
): EbOrder {
  const list = attendees({ id, event_id });
  const currency = EB_EVENTS.find((e) => e.id === event_id)?.currency ?? 'USD';
  const sum = (k: keyof EbAttendee['costs']) => list.reduce((n, a) => n + a.costs[k].value, 0);
  const [first = buyer.name, ...rest] = buyer.name.split(' ');
  return {
    id,
    event_id,
    created,
    changed: created,
    status,
    name: buyer.name,
    first_name: first,
    last_name: rest.join(' '),
    email: buyer.email,
    costs: {
      base_price: money(currency, sum('base_price')),
      eventbrite_fee: money(currency, sum('eventbrite_fee')),
      payment_fee: money(currency, 0),
      tax: money(currency, 0),
      gross: money(currency, sum('gross')),
    },
    attendees: list,
  };
}

export const EB_ORDERS: readonly EbOrder[] = [
  order(
    '5550001',
    '710001',
    '2026-06-01T14:05:00Z',
    { name: 'Ada Lovelace', email: 'ada@eb-buyers.test' },
    (o) => [
      att(o, 1, '9100011', 'Ada Lovelace', 'ada@eb-buyers.test', 337),
      att(o, 2, '9100011', 'Charles Babbage', 'charles@eb-buyers.test', 337),
    ],
  ),
  order(
    '5550002',
    '710001',
    '2026-06-03T09:30:00Z',
    { name: 'Grace Hopper', email: 'grace@eb-buyers.test' },
    (o) => [att(o, 1, '9100012', 'Grace Hopper', 'grace@eb-buyers.test', 512)],
  ),
  order(
    '5550003',
    '710001',
    '2026-06-10T18:45:00Z',
    { name: 'Alan Turing', email: 'alan@eb-buyers.test' },
    (o) => [
      att(o, 1, '9100011', 'Alan Turing', 'alan@eb-buyers.test', 337),
      att(o, 2, '9100013', 'Joan Clarke', 'joan@eb-buyers.test', 0),
    ],
  ),
  // Refunded at Eventbrite: imported as refunded, its ticket void, no revenue.
  order(
    '5550004',
    '710001',
    '2026-06-12T11:00:00Z',
    { name: 'Edsger Dijkstra', email: 'edsger@eb-buyers.test' },
    (o) => [att(o, 1, '9100011', 'Edsger Dijkstra', 'edsger@eb-buyers.test', 337, { refunded: true })],
    'refunded',
  ),
  order(
    '5550005',
    '710002',
    '2026-09-20T07:15:00Z',
    { name: 'Emmy Noether', email: 'emmy@eb-buyers.test' },
    (o) => [
      att(o, 1, '9100021', 'Emmy Noether', 'emmy@eb-buyers.test', 110),
      att(o, 2, '9100021', 'Lise Meitner', 'lise@eb-buyers.test', 110),
      att(o, 3, '9100021', 'Otto Hahn', 'otto@eb-buyers.test', 110),
    ],
  ),
  order(
    '5550006',
    '710002',
    '2026-09-22T16:40:00Z',
    { name: 'Marie Curie', email: 'marie@eb-buyers.test' },
    (o) => [att(o, 1, '9100022', 'Marie Curie', 'marie@eb-buyers.test', 0)],
  ),
  order(
    '5550007',
    '710003',
    '2026-09-25T20:10:00Z',
    { name: 'Katherine Johnson', email: 'katherine@eb-buyers.test' },
    (o) => [
      att(o, 1, '9100031', 'Katherine Johnson', 'katherine@eb-buyers.test', 912),
      att(o, 2, '9100031', 'Dorothy Vaughan', 'dorothy@eb-buyers.test', 912),
    ],
  ),
  order(
    '5550008',
    '710003',
    '2026-09-27T13:20:00Z',
    { name: 'Mary Jackson', email: 'mary@eb-buyers.test' },
    (o) => [att(o, 1, '9100031', 'Mary Jackson', 'mary@eb-buyers.test', 912)],
  ),
  order(
    '5550009',
    '710001',
    '2026-07-01T08:00:00Z',
    { name: 'Hedy Lamarr', email: 'hedy@eb-buyers.test' },
    (o) => [
      att(o, 1, '9100013', 'Hedy Lamarr', 'hedy@eb-buyers.test', 0),
      att(o, 2, '9100013', 'George Antheil', 'george@eb-buyers.test', 0),
    ],
  ),
];

/**
 * What an import of the fixture account must reproduce (computed by hand from the data above, so a
 * change to the fixture that breaks the arithmetic fails the tests). Revenue is the gross of the
 * orders still placed, per currency, in minor units.
 */
export const EVENTBRITE_FIXTURE_COUNTS = {
  events: 3,
  ticketTypes: 6,
  orders: 9,
  paidOrders: 8,
  attendees: 15,
  activeAttendees: 14,
  revenue: [
    { currency: 'EUR', totalMinor: 8980 },
    { currency: 'USD', totalMinor: 55259 },
  ],
} as const;
