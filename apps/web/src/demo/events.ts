/**
 * DEMO OVERLAY — dev/preview only.
 *
 * Events are real since M1.4a. Sales, attendees, passes and agenda arrive with M1.5+; until then
 * the seeded showcase events (same slugs, created by `pnpm seed`) get these view-models overlaid
 * so the reference screens can be reviewed. The overlay is keyed by org slug + event slug, is
 * never shown when YAYATOH_DEV_AUTH is off, and nothing here is written to the database.
 */
import type { ProfileKey } from '@yayatoh/platform';
import type { SeriesTone } from '@yayatoh/ui';

/**
 * A message key with parameters. Parameter naming decides formatting (lib/format.ts):
 * `*Minor` → money in the event currency, `delta` → signed number, `*Date` → date in the event
 * time zone, other numbers → locale number.
 */
export type Msg = { readonly key: string; readonly params?: Readonly<Record<string, string | number>> };

export interface DemoKpi {
  readonly key: string;
  readonly value: number;
  readonly kind: 'count' | 'money';
  readonly note: Msg;
  readonly delta: Msg & { readonly tone: SeriesTone };
}

export type AttendeeStatus =
  | 'paid'
  | 'needs_seat'
  | 'awaiting_payment'
  | 'refund_requested'
  | 'attending'
  | 'pending'
  | 'declined';

export interface DemoAttendee {
  readonly id: string;
  readonly name: string;
  readonly company: string;
  readonly ticketType: string;
  readonly seat: string | null;
  readonly status: AttendeeStatus;
  readonly order: string;
}

export interface DemoEvent {
  readonly orgSlug: string;
  readonly slug: string;
  readonly profile: ProfileKey;
  readonly name: string;
  readonly tagline: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone: string;
  readonly venue: string;
  readonly city: string;
  readonly currency: string;
  readonly setupDone: number;
  readonly setupTotal: number;
  readonly kpis: readonly DemoKpi[];
  readonly trend: {
    readonly labels: readonly string[];
    readonly series: readonly {
      readonly label: string;
      readonly tone: SeriesTone;
      readonly points: readonly number[];
    }[];
  };
  readonly mix: readonly { readonly label: string; readonly tone: SeriesTone; readonly value: number }[];
  readonly attention: readonly (Msg & {
    readonly detail: Msg;
    readonly tone: 'warning' | 'danger';
    readonly action: string;
  })[];
  readonly readiness: readonly { readonly key: string; readonly done: boolean }[];
  readonly segments: readonly { readonly key: string; readonly count: number }[];
  readonly attendees: readonly DemoAttendee[];
  readonly passes: readonly {
    readonly name: string;
    readonly price: number;
    readonly description: string;
    readonly featured?: boolean;
  }[];
  readonly stats: readonly { readonly key: string; readonly value: number }[];
  readonly agenda: readonly { readonly time: string; readonly title: string; readonly room: string }[];
}

const weeks = Array.from({ length: 16 }, (_, i) => String(16 - i));
const curve = (total: number, shape: number) =>
  weeks.map((_, i) => Math.round(total * ((i + 1) / weeks.length) ** shape));

const summit: DemoEvent = {
  orgSlug: 'lakeside-events',
  slug: 'midwest-leadership-summit-2027',
  profile: 'conference',
  name: 'Midwest Leadership Summit 2027',
  tagline: 'Three days of keynotes, workshops and peer roundtables.',
  startsAt: '2027-10-14T09:00:00-05:00',
  endsAt: '2027-10-16T17:00:00-05:00',
  timezone: 'America/Chicago',
  venue: 'Lakeside Convention Center',
  city: 'Chicago',
  currency: 'USD',
  setupDone: 7,
  setupTotal: 10,
  kpis: [
    {
      key: 'registrations',
      value: 1842,
      kind: 'count',
      note: { key: 'kpi.goal', params: { goal: 2000 } },
      delta: { key: 'kpi.thisWeek', params: { delta: 128 }, tone: 'primary' },
    },
    {
      key: 'grossSales',
      value: 41238000,
      kind: 'money',
      note: { key: 'kpi.net', params: { valueMinor: 40591000 } },
      delta: { key: 'kpi.thisWeek', params: { deltaMinor: 3140000 }, tone: 'success' },
    },
    {
      key: 'distributed',
      value: 1610,
      kind: 'count',
      note: { key: 'kpi.ofSold', params: { sold: 1842, pct: 87 } },
      delta: { key: 'kpi.thisWeek', params: { delta: 96 }, tone: 'brand' },
    },
    {
      key: 'seated',
      value: 1475,
      kind: 'count',
      note: { key: 'kpi.unseated', params: { count: 367 } },
      delta: { key: 'kpi.atSubEvent', params: { count: 37, name: 'Gala Dinner' }, tone: 'warning' },
    },
  ],
  trend: {
    labels: weeks,
    series: [
      { label: '2027', tone: 'primary', points: curve(1842, 1.6).slice(0, 13) },
      { label: '2026', tone: 'muted', points: curve(1710, 1.8) },
      { label: '2025', tone: 'faint', points: curve(1390, 1.9) },
    ],
  },
  mix: [
    { label: 'General Admission', tone: 'primary', value: 58 },
    { label: 'VIP Pass', tone: 'success', value: 18 },
    { label: 'Student', tone: 'brand', value: 12 },
    { label: 'Exhibitor', tone: 'warning', value: 12 },
  ],
  attention: [
    {
      key: 'attention.unseated',
      params: { count: 37 },
      detail: { key: 'attention.layout', params: { name: 'Gala Dinner', layout: 'Ballroom' } },
      tone: 'warning',
      action: 'assignSeats',
    },
    {
      key: 'attention.undistributed',
      params: { count: 120 },
      detail: { key: 'attention.distributeLater', params: { count: 18 } },
      tone: 'warning',
      action: 'remindBuyers',
    },
    {
      key: 'attention.paymentsFailed',
      params: { count: 14 },
      detail: { key: 'attention.last24h' },
      tone: 'danger',
      action: 'review',
    },
  ],
  readiness: [
    { key: 'ticketsOnSale', done: true },
    { key: 'seatingPublished', done: true },
    { key: 'payoutsConnected', done: true },
    { key: 'brandingDone', done: false },
    { key: 'scannersEnrolled', done: false },
  ],
  segments: [
    { key: 'all', count: 1842 },
    { key: 'registered', count: 1610 },
    { key: 'needsSeat', count: 367 },
    { key: 'awaitingPayment', count: 46 },
    { key: 'waitlist', count: 24 },
  ],
  attendees: [
    ['Amara Okafor', 'Northwind Labs', 'VIP Pass', 'Table 12 · Seat 4', 'paid', 'Y2-104812'],
    ['Daniel Kim', 'Brightline Health', 'General', 'Row F · 14', 'paid', 'Y2-104818'],
    ['Sofia Martinez', 'Cobalt Partners', 'General', null, 'needs_seat', 'Y2-104821'],
    ['Priya Raman', 'Summit Credit Union', 'Student', null, 'awaiting_payment', 'Y2-104830'],
    ['Marcus Johnson', 'Keystone Logistics', 'VIP Pass', 'Table 3 · Seat 1', 'paid', 'Y2-104836'],
    ['Elena Petrova', 'Aurora Analytics', 'Exhibitor', 'Booth 214', 'paid', 'Y2-104840'],
    ['Kwame Mensah', 'Riverbend Schools', 'General', 'Row C · 7', 'paid', 'Y2-104847'],
    ['Hannah Weiss', 'Meridian Bank', 'General', null, 'needs_seat', 'Y2-104851'],
    ['Luis Fernandez', 'Sunpeak Energy', 'VIP Pass', 'Table 12 · Seat 5', 'paid', 'Y2-104856'],
    ['Aisha Rahman', 'Harborview Clinic', 'General', 'Row A · 2', 'refund_requested', 'Y2-104860'],
  ].map(([name, company, ticketType, seat, status, order], i) => ({
    id: `a${i + 1}`,
    name: name as string,
    company: company as string,
    ticketType: ticketType as string,
    seat: seat as string | null,
    status: status as AttendeeStatus,
    order: order as string,
  })),
  passes: [
    { name: 'General Admission', price: 24900, description: 'All keynotes, sessions and the expo hall' },
    {
      name: 'VIP Pass',
      price: 49900,
      description: 'Reserved seating, VIP Reception and lounge',
      featured: true,
    },
    { name: 'Student', price: 9900, description: 'Valid student ID required at entry' },
  ],
  stats: [
    { key: 'days', value: 3 },
    { key: 'sessions', value: 60 },
    { key: 'speakers', value: 48 },
    { key: 'attendees', value: 2000 },
  ],
  agenda: [
    { time: '09:00', title: 'Opening keynote', room: 'Hall A' },
    { time: '10:30', title: 'Leadership in Practice', room: 'Room 204' },
    { time: '12:15', title: 'Lunch & roundtables', room: 'Terrace' },
  ],
};

const wedding: DemoEvent = {
  orgSlug: 'rosewood-weddings',
  slug: 'harper-and-theo',
  profile: 'wedding',
  name: 'Harper & Theo',
  tagline: 'A weekend in the vineyard with the people we love.',
  startsAt: '2027-06-12T16:00:00-07:00',
  endsAt: '2027-06-12T23:30:00-07:00',
  timezone: 'America/Los_Angeles',
  venue: 'Rosewood Vineyard',
  city: 'Napa',
  currency: 'USD',
  setupDone: 5,
  setupTotal: 9,
  kpis: [
    {
      key: 'invited',
      value: 182,
      kind: 'count',
      note: { key: 'kpi.households', params: { count: 94 } },
      delta: { key: 'kpi.thisWeek', params: { delta: 6 }, tone: 'primary' },
    },
    {
      key: 'attending',
      value: 131,
      kind: 'count',
      note: { key: 'kpi.declined', params: { count: 12 } },
      delta: { key: 'kpi.thisWeek', params: { delta: 19 }, tone: 'success' },
    },
    {
      key: 'awaitingReply',
      value: 39,
      kind: 'count',
      note: { key: 'kpi.deadline', params: { dateDate: '2027-05-01' } },
      delta: { key: 'kpi.reminded', params: { count: 22 }, tone: 'brand' },
    },
    {
      key: 'seated',
      value: 96,
      kind: 'count',
      note: { key: 'kpi.unseated', params: { count: 35 } },
      delta: { key: 'kpi.tables', params: { count: 16 }, tone: 'warning' },
    },
  ],
  trend: {
    labels: weeks,
    series: [{ label: 'RSVP', tone: 'primary', points: curve(131, 1.3).slice(0, 12) }],
  },
  mix: [
    { label: 'Attending', tone: 'success', value: 131 },
    { label: 'Awaiting reply', tone: 'primary', value: 39 },
    { label: 'Declined', tone: 'brand', value: 12 },
  ],
  attention: [
    {
      key: 'attention.unseated',
      params: { count: 35 },
      detail: { key: 'attention.layout', params: { name: 'Reception', layout: 'Barrel room' } },
      tone: 'warning',
      action: 'assignSeats',
    },
    {
      key: 'attention.noMeal',
      params: { count: 17 },
      detail: { key: 'attention.caterer', params: { dateDate: '2027-05-15' } },
      tone: 'danger',
      action: 'remindGuests',
    },
  ],
  readiness: [
    { key: 'invitationsSent', done: true },
    { key: 'websitePublished', done: true },
    { key: 'seatingPublished', done: false },
    { key: 'mealChoices', done: false },
  ],
  segments: [
    { key: 'all', count: 182 },
    { key: 'attending', count: 131 },
    { key: 'needsSeat', count: 35 },
    { key: 'pending', count: 39 },
  ],
  attendees: [
    ['Nora Bennett', 'Bride’s family', 'Adult', 'Table 1 · Seat 2', 'attending', 'Bennett household'],
    ['Oliver Bennett', 'Bride’s family', 'Adult', 'Table 1 · Seat 3', 'attending', 'Bennett household'],
    ['Priya Shah', 'Friends', 'Adult', null, 'pending', 'Shah household'],
    ['Leo Martins', 'Groom’s family', 'Child', 'Table 4 · Seat 6', 'attending', 'Martins household'],
    ['Grace Kim', 'Friends', 'Adult', null, 'declined', 'Kim household'],
  ].map(([name, company, ticketType, seat, status, order], i) => ({
    id: `g${i + 1}`,
    name: name as string,
    company: company as string,
    ticketType: ticketType as string,
    seat: seat as string | null,
    status: status as AttendeeStatus,
    order: order as string,
  })),
  passes: [],
  stats: [
    { key: 'guests', value: 182 },
    { key: 'tables', value: 16 },
  ],
  agenda: [
    { time: '16:00', title: 'Ceremony', room: 'Olive grove' },
    { time: '17:30', title: 'Cocktail hour', room: 'Terrace' },
    { time: '19:00', title: 'Dinner & dancing', room: 'Barrel room' },
  ],
};

const EVENTS: readonly DemoEvent[] = [summit, wedding];

/** Seeded showcase events (dev/preview) — `pnpm seed` creates real events with these slugs. */
export const DEMO_EVENTS: readonly DemoEvent[] = EVENTS;

export function demoEvent(orgSlug: string, slug: string): DemoEvent | undefined {
  return EVENTS.find((e) => e.orgSlug === orgSlug && e.slug === slug);
}

/** Public lookup for the event page (listed, published demo events only). */
export function publicDemoEvent(slug: string): DemoEvent | undefined {
  return EVENTS.find((e) => e.slug === slug && e.profile !== 'wedding');
}
