import { once } from 'node:events';
import {
  closeSync,
  createReadStream,
  createWriteStream,
  mkdtempSync,
  openSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { formatInsert, type SqlValue } from '@yayatoh/legacy-mask';
import { localDate, wallClock, wallToInstant } from '../time.ts';
import { createTableSql, SYNTH_TABLES, type SynthTable } from './tables.ts';

/**
 * Deterministic synthetic legacy dumps (M2.2b). Everything here is invented: names, addresses, card
 * gateways' references and keys; emails use reserved example domains only. The shapes mirror the
 * legacy app (per the legacy migrations and code, read for this spec): organizers and their
 * sub-accounts, events with inline venues and repetitive schedules, bookings grouped by
 * `common_order` (one row per person, or one distributable row per ticket type), attendees whose
 * email sits in `address`, gateway transactions, per-booking commissions, check-ins per booking per
 * day, promo codes, cancellations and refunds, hand-on (distributed) bookings, users sharing an
 * email across both instances, DST edge cases, a few duplicated `order_number`s, and invalid JSON in
 * a content column.
 */
export type Instance = 'yay' | 'abc';

export interface SynthScale {
  readonly organizers: number;
  readonly eventsPerOrganizer: readonly [number, number];
  readonly customers: number;
  readonly ordersPerEvent: readonly [number, number];
}

export const SCALES: Record<string, Record<Instance, SynthScale>> = {
  /** Integration tests: a few hundred bookings per instance. */
  small: {
    yay: { organizers: 4, eventsPerOrganizer: [2, 3], customers: 60, ordersPerEvent: [4, 10] },
    abc: { organizers: 3, eventsPerOrganizer: [1, 3], customers: 40, ordersPerEvent: [3, 8] },
  },
  /** The e2e dataset (plus the fixed demo org). */
  demo: {
    yay: { organizers: 2, eventsPerOrganizer: [1, 2], customers: 20, ordersPerEvent: [2, 5] },
    abc: { organizers: 2, eventsPerOrganizer: [1, 2], customers: 15, ordersPerEvent: [2, 4] },
  },
  /** Timed runs: ~5,000 events and ~200,000 booking rows across both instances. */
  large: {
    yay: { organizers: 400, eventsPerOrganizer: [6, 14], customers: 60_000, ordersPerEvent: [10, 42] },
    abc: { organizers: 100, eventsPerOrganizer: [6, 14], customers: 18_000, ordersPerEvent: [10, 42] },
  },
};

export interface SynthOptions {
  readonly instance: Instance;
  readonly seed?: number;
  readonly scale?: SynthScale | keyof typeof SCALES;
  /** "Today" for the dataset: splits past from upcoming events (fixed, so output is stable). */
  readonly anchor?: string;
  /** Add the fixed demo organizer and its live weekly event (e2e; yay only). */
  readonly demo?: boolean;
}

export interface SynthSummary {
  readonly instance: Instance;
  readonly rows: Record<string, number>;
  /** Facts tests rely on (ids of planted edge cases). */
  readonly facts: {
    readonly duplicateOrderNumbers: string[];
    readonly invalidJsonEvents: number[];
    readonly dstEvents: { id: number; kind: 'fold' | 'gap' }[];
    readonly sharedEmails: string[];
    readonly hijackEmails: string[];
  };
}

export const SYNTHETIC_MARKER = 'SYNTHETIC TEST DATA ONLY';
/** bcrypt ($2y$, cost 10) of `synthetic-password`: every synthetic user's password. */
export const SYNTH_PASSWORD = 'synthetic-password';
export const SYNTH_PASSWORD_HASH = '$2y$10$LUQPdLgTiQhg7yN/rRTahOYFdNzq23OYlCi0s8O9KgLwIjCUmiSvy';

export const PLATFORM_TZ: Record<Instance, string> = { yay: 'America/New_York', abc: 'America/Chicago' };

/** The demo organizer and event (e2e): stable names the browser tests look for. */
export const DEMO = {
  ownerEmail: 'lakeshore.jazz@example.org',
  ownerName: 'Lena Lakeshore',
  organisation: 'Lakeshore Jazz Society',
  eventTitle: 'Lakeshore Jazz Weekly',
  eventSlug: 'lakeshore-jazz-weekly',
  pastEventTitle: 'Lakeshore Spring Gala',
  buyerEmail: 'ruth.fictional@example.org',
  buyerName: 'Ruth Fictional',
  scanBuyers: ['mobile-375', 'tablet-768', 'desktop-1280'].map((p) => ({
    project: p,
    email: `door.${p}@example.org`,
    name: `Door Guest ${p.split('-')[0]}`,
  })),
} as const;

// ---------------------------------------------------------------------------------------------

/** mulberry32: small, fast, deterministic. */
class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)] as T;
  }
}

const FIRST = [
  'Ada',
  'Bram',
  'Cleo',
  'Dev',
  'Esme',
  'Farid',
  'Gia',
  'Hugo',
  'Ines',
  'Jonah',
  'Kira',
  'Luca',
  'Mina',
  'Nils',
  'Oona',
  'Pavel',
  'Quinn',
  'Rosa',
  'Sami',
  'Tova',
  'Uma',
  'Viggo',
  'Wren',
  'Xena',
  'Yusuf',
  'Zara',
  'Zoë',
  'José',
  'Åsa',
  'Chloé',
];
const LAST = [
  'Fictional',
  'Madeup',
  'Imaginary',
  'Pretend',
  'Invented',
  'Notreal',
  'Sample',
  'Placeholder',
  'Testwood',
  'Dummyfield',
  'Fakesmith',
  'Mockley',
];
const VENUES = [
  'Harbor Hall',
  'Riverside Loft',
  'The Glasshouse',
  'Maple Ballroom',
  'Old Mill Stage',
  'Lakeview Pavilion',
  'Union Depot',
  'Cedar Theater',
  'Northside Commons',
  'Skyline Terrace',
];
const KINDS = [
  'Gala',
  'Summit',
  'Jazz Night',
  'Workshop',
  'Festival',
  'Fundraiser',
  'Mixer',
  'Concert',
  'Conference',
  'Showcase',
];
const TICKETS = ['General Admission', 'VIP', 'Early Bird', 'Student', 'Table Seat', 'Backstage', 'Donation'];
const PLACES: Record<Instance, { city: string; state: string; weight: number }[]> = {
  yay: [
    { city: 'New York', state: 'NY', weight: 5 },
    { city: 'Atlanta', state: 'GA', weight: 3 },
    { city: 'Los Angeles', state: 'CA', weight: 2 },
    { city: 'Chicago', state: 'IL', weight: 2 },
    { city: 'Phoenix', state: 'AZ', weight: 1 },
    { city: 'Houston', state: 'Texas', weight: 1 },
    { city: 'Miami', state: 'FL', weight: 1 },
  ],
  abc: [
    { city: 'Chicago', state: 'IL', weight: 8 },
    { city: 'Evanston', state: 'Illinois', weight: 1 },
    { city: 'Milwaukee', state: 'WI', weight: 1 },
  ],
};
const GATEWAYS = ['Stripe', 'Stripe Direct', 'PayPal', 'Offline'] as const;

interface UserRow {
  id: number;
  name: string;
  email: string;
  roleId: number;
  created: string;
  verified: string | null;
  organizerId: number | null;
  stripeAccount: string | null;
  organisation: string | null;
}

interface TicketRow {
  id: number;
  eventId: number;
  title: string;
  priceCents: number;
  quantity: number;
  salePriceCents: number | null;
  saleEnd: string | null;
  isDonation: boolean;
  limit: number | null;
}

interface EventRow {
  id: number;
  ownerId: number;
  title: string;
  slug: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  repetitive: boolean;
  occurrences: string[];
  currency: string;
  taxBps: number;
  commissionBps: number | null;
  free: boolean;
  created: string;
  tickets: TicketRow[];
  city: string;
  state: string;
}

const money = (cents: number) => ({ kind: 'num', raw: (cents / 100).toFixed(2) }) as const;
const num = (n: number | null): SqlValue => (n === null ? { kind: 'null' } : { kind: 'num', raw: String(n) });
const str = (s: string | null): SqlValue => (s === null ? { kind: 'null' } : { kind: 'str', value: s });

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Writes one table's rows as batched extended INSERTs (mysqldump's shape). */
class TableWriter {
  private rows: SqlValue[][] = [];
  count = 0;
  private readonly out: Sink;
  readonly table: SynthTable;
  constructor(out: Sink, table: SynthTable) {
    this.out = out;
    this.table = table;
  }
  async add(values: Record<string, SqlValue>) {
    this.rows.push(this.table.columns.map((c) => values[c.name] ?? { kind: 'null' }));
    this.count++;
    if (this.rows.length >= 400) await this.flush();
  }
  async flush() {
    if (!this.rows.length) return;
    await this.out.write(
      formatInsert({ table: this.table.name, columns: null, rows: this.rows, verb: 'INSERT' }),
    );
    this.rows = [];
  }
}

interface Sink {
  write(s: string): Promise<void>;
}

/**
 * Generate one instance's dump. The dump is written table by table (as mysqldump orders it) through
 * temporary per-table buffers, so memory stays proportional to the largest table's pending batch.
 */
export async function generateDump(target: Writable, opts: SynthOptions): Promise<SynthSummary> {
  const inst = opts.instance;
  const scale = typeof opts.scale === 'object' ? opts.scale : SCALES[opts.scale ?? 'small']?.[inst];
  if (!scale) throw new Error(`unknown scale ${String(opts.scale)}`);
  const rng = new Rng((opts.seed ?? 20260927) ^ (inst === 'yay' ? 0x5eed : 0xabc0));
  const tz = PLATFORM_TZ[inst];
  const anchor = opts.anchor ?? '2026-09-01';
  const anchorMs = Date.parse(`${anchor}T12:00:00Z`);

  // Per-table spool files: the dump lists tables in SYNTH_TABLES order, rows spooled as generated.
  const spool = mkdtempSync(join(tmpdir(), `legacy-synth-${inst}-`));
  const files = new Map<string, number>();
  const writers = new Map<string, TableWriter>();
  for (const t of SYNTH_TABLES) {
    const fd = openSync(join(spool, `${t.name}.sql`), 'w');
    files.set(t.name, fd);
    writers.set(
      t.name,
      new TableWriter(
        {
          write: async (s) => {
            writeSync(fd, s);
          },
        },
        t,
      ),
    );
  }
  const w = (name: string) => writers.get(name) as TableWriter;
  const facts: SynthSummary['facts'] = {
    duplicateOrderNumbers: [],
    invalidJsonEvents: [],
    dstEvents: [],
    sharedEmails: [],
    hijackEmails: [],
  };

  // Platform-tz wall clock of an instant (legacy system timestamps).
  const wall = (ms: number) => wallClock(ms, tz);
  const daysAgo = (d: number, jitterH = 0) => anchorMs - d * 86_400_000 + jitterH * 3_600_000;

  // --- reference data ------------------------------------------------------------------------
  const settings: [string, string][] = [
    ['regional.timezone_default', tz],
    ['regional.currency_default', 'USD'],
    ['multi-vendor.admin_commission', inst === 'yay' ? '8' : '6'],
    ['site.site_name', inst === 'yay' ? 'Yayatoh (synthetic)' : 'ABC (synthetic)'],
  ];
  for (const [i, [key, value]] of settings.entries())
    await w('settings').add({
      id: num(i + 1),
      key: str(key),
      display_name: str(key),
      value: str(value),
      type: str('text'),
      order: num(i + 1),
      group: str(key.split('.')[0] ?? null),
    });
  const roles = ['admin', 'customer', 'organiser', 'pos', 'scanner', 'manager', 'suborganizer'];
  for (const [i, r] of roles.entries())
    await w('roles').add({
      id: num(i + 1),
      name: str(r),
      display_name: str(r),
      created_at: str('2019-10-23 06:03:51'),
    });
  const countries: [number, string, string][] = [
    [231, 'US', 'United States'],
    [38, 'CA', 'Canada'],
    [230, 'GB', 'United Kingdom'],
  ];
  for (const [id, code, name] of countries)
    await w('countries').add({ id: num(id), country_code: str(code), country_name: str(name) });
  const categories = ['Music', 'Business', 'Community', 'Arts'];
  for (const [i, n] of categories.entries())
    await w('categories').add({ id: num(i + 1), name: str(n), slug: str(n.toLowerCase()), status: num(1) });

  // --- users -----------------------------------------------------------------------------------
  const users: UserRow[] = [];
  let userId = 0;
  const person = (i: number) =>
    `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`;
  const addUser = (u: Omit<UserRow, 'id'>) => {
    const row = { ...u, id: ++userId };
    users.push(row);
    return row;
  };
  const admin = addUser({
    name: `${inst.toUpperCase()} Admin`,
    email: `admin@${inst}.example.org`,
    roleId: 1,
    created: wall(daysAgo(2400)),
    verified: wall(daysAgo(2400)),
    organizerId: null,
    stripeAccount: null,
    organisation: inst === 'abc' ? 'ABC Events' : null,
  });
  const organizers: UserRow[] = [];
  if (opts.demo && inst === 'yay')
    organizers.push(
      addUser({
        name: DEMO.ownerName,
        email: DEMO.ownerEmail,
        roleId: 3,
        created: wall(daysAgo(900)),
        verified: wall(daysAgo(900)),
        organizerId: null,
        stripeAccount: 'acct_SYNTHDEMO0001',
        organisation: DEMO.organisation,
      }),
    );
  for (let i = 0; i < scale.organizers; i++) {
    const n = person(i * 7 + (inst === 'abc' ? 3 : 0));
    const created = daysAgo(rng.int(400, 2200));
    organizers.push(
      addUser({
        name: n,
        email: `organizer.${inst}.${i + 1}@example.org`,
        roleId: 3,
        created: wall(created),
        verified: wall(created + 3_600_000),
        organizerId: null,
        stripeAccount: rng.chance(0.5) ? `acct_SYNTH${inst.toUpperCase()}${pad(i + 1, 6)}` : null,
        organisation: `${n.split(' ')[1]} ${rng.pick(['Events', 'Productions', 'Collective', 'Society'])} ${i + 1}`,
      }),
    );
  }
  // Sub-accounts: POS (4), scanner (5), manager (6), with users.organizer_id → the organizer.
  const subAccounts: UserRow[] = [];
  for (const org of organizers) {
    const k = org.email === DEMO.ownerEmail ? 2 : rng.int(0, 2);
    for (let j = 0; j < k; j++) {
      const roleId = [5, 6, 4][j % 3] as number;
      subAccounts.push(
        addUser({
          name: `${['Pos', 'Scanner', 'Manager'][roleId - 4]} ${org.name.split(' ')[0]} ${j + 1}`,
          email: `staff.${roleId}.${org.id}.${j + 1}.${inst}@example.net`,
          roleId,
          created: org.created,
          verified: org.created,
          organizerId: org.id,
          stripeAccount: null,
          organisation: null,
        }),
      );
    }
  }
  // Customers. The first 12% share their email with the other instance (identity merge), written
  // with case and whitespace variations on abc; a few abc twins never verified and never paid
  // (the pre-hijack guard must drop their credential).
  const customers: UserRow[] = [];
  const shared = Math.max(3, Math.floor(scale.customers * 0.12));
  for (let i = 0; i < scale.customers; i++) {
    let email: string;
    let verified: string | null;
    const created = daysAgo(rng.int(30, 2000));
    if (i < shared) {
      const base = `member.${i + 1}@example.com`;
      facts.sharedEmails.push(base);
      email =
        inst === 'abc'
          ? i % 3 === 0
            ? ` Member.${i + 1}@Example.COM `
            : i % 3 === 1
              ? `MEMBER.${i + 1}@example.com`
              : base
          : base;
      verified = inst === 'abc' && i % 4 === 3 ? null : wall(created + 600_000);
      if (verified === null) facts.hijackEmails.push(base);
    } else {
      email = `guest.${inst}.${i + 1}@example.${rng.pick(['org', 'net', 'com'])}`;
      verified = rng.chance(0.8) ? wall(created + 600_000) : null;
    }
    customers.push(
      addUser({
        name: person(i + (inst === 'abc' ? 11 : 0)),
        email,
        roleId: 2,
        created: wall(created),
        verified,
        organizerId: null,
        stripeAccount: null,
        organisation: null,
      }),
    );
  }
  // Demo buyers (e2e).
  const demoBuyers: UserRow[] = [];
  if (opts.demo && inst === 'yay')
    for (const b of [{ email: DEMO.buyerEmail, name: DEMO.buyerName }, ...DEMO.scanBuyers])
      demoBuyers.push(
        addUser({
          name: b.name,
          email: b.email,
          roleId: 2,
          created: wall(daysAgo(120)),
          verified: wall(daysAgo(120)),
          organizerId: null,
          stripeAccount: null,
          organisation: null,
        }),
      );
  const hijackable = new Set(customers.filter((c, i) => i < shared && c.verified === null).map((c) => c.id));

  // --- events and tickets ------------------------------------------------------------------------
  const events: EventRow[] = [];
  let eventId = 0;
  let ticketId = 0;
  let scheduleId = 0;
  let serversideId = 0;
  const placeFor = () => {
    const places = PLACES[inst];
    const total = places.reduce((a, p) => a + p.weight, 0);
    let r = rng.next() * total;
    for (const p of places) {
      r -= p.weight;
      if (r <= 0) return p;
    }
    return places[0] as (typeof places)[number];
  };
  const slugs = new Map<string, number>();
  const makeTickets = (
    ev: EventRow,
    specs: { title: string; price: number; qty: number; donation?: boolean }[],
  ) => {
    for (const s of specs) {
      const sale = !ev.free && !s.donation && rng.chance(0.15);
      ev.tickets.push({
        id: ++ticketId,
        eventId: ev.id,
        title: s.title,
        priceCents: s.price,
        quantity: s.qty,
        salePriceCents: sale ? Math.round(s.price * 0.8) : null,
        saleEnd: sale ? wall(Date.parse(`${ev.startDate}T12:00:00Z`) - 20 * 86_400_000) : null,
        isDonation: s.donation ?? false,
        limit: rng.chance(0.3) ? 6 : null,
      });
    }
  };
  const addEvent = (
    owner: UserRow,
    spec: Partial<EventRow> & { title: string; startDate: string },
  ): EventRow => {
    const place = spec.city ? { city: spec.city, state: spec.state ?? 'IL' } : placeFor();
    let slug =
      spec.slug ??
      spec.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const seen = slugs.get(slug) ?? 0;
    slugs.set(slug, seen + 1);
    // Legacy slugs are not unique: keep a few duplicates on purpose.
    if (seen > 0 && !rng.chance(0.3)) slug = `${slug}-${seen + 1}`;
    const ev: EventRow = {
      id: ++eventId,
      ownerId: owner.id,
      title: spec.title,
      slug,
      startDate: spec.startDate,
      endDate: spec.endDate ?? spec.startDate,
      startTime: spec.startTime ?? `${pad(rng.int(10, 20))}:00:00`,
      endTime: spec.endTime ?? '23:00:00',
      repetitive: spec.repetitive ?? false,
      occurrences: spec.occurrences ?? [spec.startDate],
      currency: spec.currency ?? (inst === 'yay' && rng.chance(0.05) ? 'CAD' : 'USD'),
      taxBps: spec.taxBps ?? (rng.chance(0.2) ? 500 : 0),
      commissionBps: spec.commissionBps !== undefined ? spec.commissionBps : rng.chance(0.25) ? 500 : null,
      free: spec.free ?? rng.chance(0.08),
      created:
        spec.created ?? wall(Date.parse(`${spec.startDate}T12:00:00Z`) - rng.int(30, 200) * 86_400_000),
      tickets: [],
      city: place.city,
      state: place.state,
    };
    events.push(ev);
    return ev;
  };

  // The demo organizer: a live weekly series (Tuesdays, 2026-01-06 → 2030-12-31) and a past gala.
  const demoOwner = organizers.find((o) => o.email === DEMO.ownerEmail);
  let demoWeekly: EventRow | null = null;
  let demoGala: EventRow | null = null;
  if (demoOwner) {
    const occ: string[] = [];
    for (let d = '2026-01-06'; d <= '2030-12-31'; d = addDays(d, 7)) occ.push(d);
    demoWeekly = addEvent(demoOwner, {
      title: DEMO.eventTitle,
      slug: DEMO.eventSlug,
      startDate: '2026-01-06',
      endDate: '2030-12-31',
      startTime: '12:00:00',
      endTime: '23:00:00',
      repetitive: true,
      occurrences: occ,
      city: 'Chicago',
      state: 'IL',
      currency: 'USD',
      taxBps: 0,
      commissionBps: null,
      free: false,
      created: wall(daysAgo(300)),
    });
    makeTickets(demoWeekly, [
      { title: 'Season Pass', price: 4500, qty: 400 },
      { title: 'Door Ticket', price: 2000, qty: 800 },
    ]);
    demoGala = addEvent(demoOwner, {
      title: DEMO.pastEventTitle,
      slug: 'lakeshore-spring-gala',
      startDate: '2026-04-18',
      startTime: '18:30:00',
      endTime: '23:30:00',
      city: 'Chicago',
      state: 'IL',
      currency: 'USD',
      taxBps: 500,
      commissionBps: null,
      free: false,
      created: wall(daysAgo(250)),
    });
    makeTickets(demoGala, [
      { title: 'Gala Seat', price: 12000, qty: 200 },
      { title: 'Donation', price: 1000, qty: 100, donation: true },
    ]);
  }

  // ABC: the admin (the ABC host) runs the flagship events; affiliates run the rest.
  const hosts = inst === 'abc' ? [admin, ...organizers] : organizers.filter((o) => o !== demoOwner);
  for (const owner of hosts) {
    const n = rng.int(scale.eventsPerOrganizer[0], scale.eventsPerOrganizer[1]);
    for (let k = 0; k < n; k++) {
      const offset = rng.int(-700, 200); // days from anchor
      const start = new Date(anchorMs + offset * 86_400_000).toISOString().slice(0, 10);
      const title = `${owner.organisation?.split(' ')[0] ?? owner.name.split(' ')[1]} ${rng.pick(KINDS)} ${start.slice(0, 4)}`;
      const repetitive = rng.chance(0.1);
      let occurrences = [start];
      let endDate = start;
      if (repetitive) {
        occurrences = [];
        for (let d = start, i = 0; i < 8; i++, d = addDays(d, 7)) occurrences.push(d);
        endDate = occurrences[occurrences.length - 1] as string;
      } else if (rng.chance(0.15)) endDate = addDays(start, 1);
      const ev = addEvent(owner, { title, startDate: start, endDate, repetitive, occurrences });
      const specs = Array.from({ length: rng.int(1, 3) }, (_, i) => ({
        title: TICKETS[(i + k) % 6] as string,
        price: ev.free ? 0 : rng.pick([1500, 2000, 2500, 3500, 5000, 7500, 12000]),
        qty: rng.int(80, 600),
      }));
      if (!ev.free && rng.chance(0.1))
        specs.push({ title: 'Donation', price: 500, qty: 200, donation: true } as never);
      makeTickets(ev, specs);
    }
  }
  // DST edge cases (platform wall clock): a start inside the fall-back fold and one inside the
  // spring-forward gap. The transforms log both.
  if (hosts[0] && inst === 'yay') {
    const fold = addEvent(hosts[0], {
      title: 'Midnight Fold Party',
      startDate: '2025-11-02',
      startTime: '01:30:00',
      endTime: '05:00:00',
      city: 'New York',
      state: 'NY',
    });
    makeTickets(fold, [{ title: 'General Admission', price: 2000, qty: 100 }]);
    facts.dstEvents.push({ id: fold.id, kind: 'fold' });
    const gap = addEvent(hosts[0], {
      title: 'Spring Forward Brunch',
      startDate: '2026-03-08',
      startTime: '02:30:00',
      endTime: '11:00:00',
      city: 'New York',
      state: 'NY',
    });
    makeTickets(gap, [{ title: 'General Admission', price: 2000, qty: 100 }]);
    facts.dstEvents.push({ id: gap.id, kind: 'gap' });
  }
  if (hosts[0] && inst === 'abc') {
    const fold = addEvent(hosts[0], {
      title: 'ABC Fall Back Social',
      startDate: '2025-11-02',
      startTime: '01:15:00',
      endTime: '04:00:00',
      city: 'Chicago',
      state: 'IL',
    });
    makeTickets(fold, [{ title: 'General Admission', price: 1500, qty: 100 }]);
    facts.dstEvents.push({ id: fold.id, kind: 'fold' });
  }

  // Invalid JSON in a content column (events.images): at most 1 in 400 events (under 0.5%).
  const invalidJsonEvery = 400;
  for (const ev of events) {
    const bad = events.length >= invalidJsonEvery && ev.id % invalidJsonEvery === 7;
    if (bad) facts.invalidJsonEvents.push(ev.id);
    const countryId = 231;
    await w('events').add({
      id: num(ev.id),
      title: str(ev.title),
      description: str(`<p>${ev.title}: an invented event. ${SYNTHETIC_MARKER}.</p>`),
      images: str(bad ? '["events/broken.jpg",' : JSON.stringify([`events/${ev.id}/cover.jpg`])),
      venue: str(rng.pick(VENUES)),
      address: str(`${rng.int(1, 999)} Imaginary Ave`),
      city: str(ev.city),
      state: str(ev.state),
      zipcode: str(pad(rng.int(10000, 99999), 5)),
      country_id: num(countryId),
      start_date: str(ev.startDate),
      end_date: str(ev.endDate),
      start_time: str(ev.startTime),
      end_time: str(ev.endTime),
      repetitive: num(ev.repetitive ? 1 : 0),
      featured: num(0),
      status: num(ev.id % 97 === 0 ? 0 : 1),
      category_id: num(rng.int(1, categories.length)),
      user_id: num(ev.ownerId),
      created_at: str(ev.created),
      updated_at: str(ev.created),
      slug: str(ev.slug),
      price_type: num(ev.free ? 0 : 1),
      publish: num(ev.id % 53 === 0 ? 0 : 1),
      is_publishable: str('{"detail":1,"location":1,"media":1,"tickets":1,"timing":1}'),
      merge_schedule: num(0),
      e_admin_commission: ev.commissionBps === null ? num(null) : money(ev.commissionBps),
      currency: str(ev.currency),
      is_private: num(ev.id % 41 === 0 ? 1 : 0),
      private_info: str(ev.id % 3 === 0 ? JSON.stringify({ wifi: 'invented-network' }) : null),
    });
    if (ev.repetitive) {
      // One schedules row per month (weekly type 2) and its serverside_dates expansion.
      const months = [...new Set(ev.occurrences.map((d) => d.slice(0, 7)))];
      const weekday = new Date(`${ev.startDate}T00:00:00Z`).getUTCDay();
      for (const m of months) {
        const last = addDays(`${addDays(`${m}-28`, 4).slice(0, 7)}-01`, -1);
        await w('schedules').add({
          id: num(++scheduleId),
          repetitive_type: num(2),
          repetitive_days: str(String(weekday)),
          from_date: str(`${m}-01`),
          to_date: str(last),
          from_time: str(ev.startTime),
          to_time: str(ev.endTime),
          event_id: num(ev.id),
          user_id: num(ev.ownerId),
          status: num(1),
          created_at: str(ev.created),
        });
        await w('serverside_dates').add({
          id: num(++serversideId),
          from_date: str(`${m}-01`),
          dates: str(JSON.stringify(ev.occurrences.filter((d) => d.startsWith(m)))),
          event_id: num(ev.id),
          user_id: num(ev.ownerId),
          created_at: str(ev.created),
        });
      }
    }
    for (const [i, t] of ev.tickets.entries())
      await w('tickets').add({
        id: num(t.id),
        title: str(t.title),
        price: money(t.priceCents),
        quantity: num(t.quantity),
        description: str(null),
        event_id: num(ev.id),
        created_at: str(ev.created),
        updated_at: str(ev.created),
        status: num(1),
        access_dates: str(null),
        customer_limit: num(t.limit),
        sale_start_date: str(null),
        sale_end_date: str(t.saleEnd),
        sale_price: t.salePriceCents === null ? num(null) : money(t.salePriceCents),
        is_donation: num(t.isDonation ? 1 : 0),
        order: num(i),
      });
  }
  // Sub-account event assignments (user_roles with event_id).
  for (const s of subAccounts) {
    const own = events.filter((e) => e.ownerId === s.organizerId);
    for (const e of own.slice(0, 2))
      await w('user_roles').add({ user_id: num(s.id), role_id: num(s.roleId), event_id: num(e.id) });
  }

  // Promo codes: organizer-wide codes linked to some of their tickets.
  let promoId = 0;
  const promosByTicket = new Map<
    number,
    { id: number; code: string; kind: 'fixed' | 'percent'; reward: number }
  >();
  for (const org of organizers) {
    if (!rng.chance(0.6)) continue;
    const own = events.filter((e) => e.ownerId === org.id && !e.free);
    if (!own.length) continue;
    const kind = rng.chance(0.5) ? 'percent' : 'fixed';
    const p = {
      id: ++promoId,
      code: `${inst.toUpperCase()}SAVE${promoId}${kind === 'percent' ? 'PCT' : ''}`,
      kind,
      reward: kind === 'percent' ? 15 : 500,
    } as const;
    await w('promocodes').add({
      id: num(p.id),
      organizer_id: num(org.id),
      code: str(promoId % 4 === 0 ? `${p.code.toLowerCase()} x` : p.code),
      reward: { kind: 'num', raw: kind === 'percent' ? '15.00' : '5.00' },
      quantity: num(rng.chance(0.5) ? 500 : null),
      p_type: str(kind),
      expires_at: str(null),
      status: num(1),
      created_at: str(org.created),
    });
    for (const e of own.slice(0, 2))
      for (const t of e.tickets.filter((x) => !x.isDonation)) {
        await w('ticket_promocode').add({ promocode_id: num(p.id), ticket_id: num(t.id) });
        promosByTicket.set(t.id, p);
      }
  }

  // --- orders --------------------------------------------------------------------------------------
  let bookingId = 0;
  let txnId = 0;
  let commissionId = 0;
  let attendeeId = 0;
  let checkinId = 0;
  const orderNumbers: string[] = [];
  const counter = { n: 0 };
  // `time()` plus a sequence (the legacy app appended 5 random digits; a sequence keeps the planted
  // duplicates the only ones).
  const uniqueNumber = (ms: number) => `${Math.floor(ms / 1000)}${pad(++counter.n, 5)}`;
  const buyerPool = customers.filter((c) => !hijackable.has(c.id));
  let guestCount = 0;
  const commissionPct = (ev: EventRow) => ev.commissionBps ?? (inst === 'yay' ? 800 : 600);

  interface Line {
    ticket: TicketRow;
    qty: number;
    distributable: boolean;
  }

  const writeOrder = async (
    ev: EventRow,
    buyer: UserRow,
    lines: Line[],
    o: {
      created: number;
      occurrence: string;
      gateway: (typeof GATEWAYS)[number];
      paid: boolean;
      cancel: number;
      partialRefund: boolean;
      disabled: boolean;
      promo: boolean;
      checkedIn: boolean;
      duplicateNumber: boolean;
      attendeeOverride?: { name: string; email: string };
    },
  ) => {
    const owner = users[ev.ownerId - 1] as UserRow;
    const created = wall(o.created);
    const common = uniqueNumber(o.created);
    const online = !ev.free && o.gateway !== 'Offline';
    const rows: {
      id: number;
      t: TicketRow;
      qty: number;
      price: number;
      tax: number;
      reward: number;
      net: number;
      cancel: number;
      isPaid: boolean;
      distributable: boolean;
      orderNumber: string;
    }[] = [];
    for (const line of lines) {
      const perRow = line.distributable ? [line.qty] : Array.from({ length: line.qty }, () => 1);
      const promo = o.promo ? promosByTicket.get(line.ticket.id) : undefined;
      for (const [ri, q] of perRow.entries()) {
        const onSale =
          line.ticket.salePriceCents !== null &&
          line.ticket.saleEnd !== null &&
          created < line.ticket.saleEnd;
        const unit = ev.free
          ? 0
          : line.ticket.isDonation
            ? line.ticket.priceCents + rng.int(0, 4) * 500
            : onSale
              ? (line.ticket.salePriceCents as number)
              : line.ticket.priceCents;
        const price = unit * q;
        const tax = Math.round((price * ev.taxBps) / 10_000);
        let reward = 0;
        if (promo && price > 0)
          reward =
            promo.kind === 'percent'
              ? Math.round((price * promo.reward) / 100)
              : Math.min(price, Math.round((promo.reward * 100) / perRow.length));
        const cancel = o.partialRefund && ri === 0 && rows.length === 0 ? 3 : o.cancel;
        rows.push({
          id: ++bookingId,
          t: line.ticket,
          qty: q,
          price,
          tax,
          reward,
          net: price + tax - reward,
          cancel,
          isPaid: o.paid,
          distributable: line.distributable,
          orderNumber:
            o.duplicateNumber && rows.length === 0 && orderNumbers.length > 5
              ? (orderNumbers[orderNumbers.length - 3] as string)
              : uniqueNumber(o.created),
        });
        if (o.duplicateNumber && rows.length === 1 && orderNumbers.length > 5)
          facts.duplicateOrderNumbers.push(rows[0]?.orderNumber as string);
        orderNumbers.push(rows[rows.length - 1]?.orderNumber as string);
      }
    }
    const total = rows.reduce((a, r) => a + r.net, 0);
    let txn = 0;
    if (online && total > 0) {
      txn = ++txnId;
      await w('transactions').add({
        id: num(txn),
        amount_paid: money(total),
        item_sku: num(0),
        order_number: str(common),
        txn_id: str(o.gateway === 'PayPal' ? `PAYID-SYNTH${pad(txn, 8)}` : `txn_SYNTH${inst}${pad(txn, 10)}`),
        payer_reference: str(o.gateway === 'PayPal' ? `PAYER${pad(txn, 6)}` : null),
        currency_code: str(ev.currency),
        payment_status: str(o.gateway === 'PayPal' ? 'Completed' : 'Payment complete.'),
        payment_gateway: str(o.gateway),
        status: num(1),
        created_at: str(created),
        updated_at: str(created),
      });
    }
    const cancelledAt = wall(o.created + 5 * 86_400_000);
    for (const [rowIndex, r] of rows.entries()) {
      const disabled = o.disabled;
      await w('bookings').add({
        id: num(r.id),
        customer_id: num(buyer.id),
        organiser_id: num(owner.id),
        event_id: num(ev.id),
        ticket_id: num(r.t.id),
        quantity: num(r.qty),
        price: money(r.price),
        tax: money(r.tax),
        net_price: money(r.net),
        status: num(disabled ? 0 : 1),
        created_at: str(created),
        updated_at: str(r.cancel >= 2 ? cancelledAt : created),
        event_title: str(ev.title),
        event_start_date: str(o.occurrence),
        event_end_date: str(ev.repetitive ? o.occurrence : ev.endDate),
        event_start_time: str(ev.startTime),
        event_end_time: str(ev.endTime),
        event_repetitive: num(ev.repetitive ? 1 : 0),
        ticket_title: str(r.t.title),
        ticket_price: money(r.qty ? r.price / r.qty : 0),
        event_category: str('Music'),
        booking_cancel: num(r.cancel),
        order_number: str(r.orderNumber),
        transaction_id: num(txn),
        customer_name: str(buyer.name),
        customer_email: str(buyer.email.trim()),
        currency: str(ev.currency),
        checked_in: num(0),
        payment_type: str(txn ? 'online' : 'offline'),
        is_paid: num(r.isPaid ? 1 : 0),
        is_bulk: num(0),
        is_distributable: num(r.distributable ? 1 : 0),
        promocode_id: num(r.reward > 0 ? (promosByTicket.get(r.t.id)?.id ?? null) : null),
        promocode: str(r.reward > 0 ? (promosByTicket.get(r.t.id)?.code ?? null) : null),
        pos_id: num(null),
        scanner_id: num(null),
        common_order: str(common),
        promocode_reward: str(r.reward ? (r.reward / 100).toFixed(2) : '0'),
      });
      if (r.net > 0) {
        const paid = r.price + r.tax;
        const earning = Math.round((paid * (10_000 - commissionPct(ev))) / 10_000);
        const status = r.isPaid && r.cancel < 2 && !disabled ? 1 : 0;
        const past = Date.parse(`${ev.endDate}T00:00:00Z`) < anchorMs;
        const transferred =
          status === 1 ? (past && rng.chance(0.7) ? 1 : 0) : r.cancel === 3 && rng.chance(0.3) ? 1 : 0;
        await w('commissions').add({
          id: num(++commissionId),
          organiser_id: num(owner.id),
          booking_id: num(r.id),
          admin_commission: money(paid - earning),
          customer_paid: money(paid),
          organiser_earning: money(earning),
          transferred: num(transferred),
          month_year: str(`${created.slice(5, 7)} ${created.slice(0, 4)}`),
          status: num(status),
          created_at: str(created),
          updated_at: str(created),
          event_id: num(ev.id),
          admin_tax: money(0),
          settled: num(status === 0 && transferred === 1 && rng.chance(0.5) ? 1 : 0),
        });
      }
      // Attendees: one per person; the email lives in `address`. Distributable rows start
      // unassigned (the buyer's email) and a few are handed on to someone else.
      for (let u = 0; u < r.qty; u++) {
        const guest =
          o.attendeeOverride ??
          ((u === 0 && rowIndex === 0) || !rng.chance(0.5)
            ? { name: buyer.name, email: buyer.email.trim() }
            : {
                name: person(rng.int(0, 300)),
                email: ++guestCount % 12 === 5 ? 'N/A' : `plus.${r.id}.${u}@example.net`,
              });
        const handOn = r.distributable && u > 0 && u <= 2 && rng.chance(0.5);
        if (handOn) {
          // A hand-on: a new booking row for the recipient (auto-registered customer).
          const recipient = rng.pick(buyerPool);
          const child = ++bookingId;
          const at = o.created + 2 * 86_400_000;
          await w('bookings').add({
            id: num(child),
            customer_id: num(recipient.id),
            organiser_id: num(owner.id),
            event_id: num(ev.id),
            ticket_id: num(r.t.id),
            quantity: num(1),
            price: money(0),
            tax: money(0),
            net_price: money(0),
            status: num(1),
            created_at: str(wall(at)),
            updated_at: str(wall(at)),
            event_title: str(ev.title),
            event_start_date: str(o.occurrence),
            event_end_date: str(ev.endDate),
            event_start_time: str(ev.startTime),
            event_end_time: str(ev.endTime),
            event_repetitive: num(ev.repetitive ? 1 : 0),
            ticket_title: str(r.t.title),
            ticket_price: money(0),
            event_category: str('Music'),
            booking_cancel: num(0),
            order_number: str(uniqueNumber(at)),
            transaction_id: num(0),
            customer_name: str(recipient.name),
            customer_email: str(recipient.email.trim()),
            currency: str(ev.currency),
            checked_in: num(0),
            payment_type: str('offline'),
            is_paid: num(1),
            is_bulk: num(0),
            is_distributable: num(0),
            distributed_by: num(buyer.id),
            distributed_from_booking_id: num(r.id),
            common_order: str(uniqueNumber(at)),
            promocode_reward: str('0'),
            distributor_tag: str(null),
          });
          await w('attendees').add({
            id: num(++attendeeId),
            user_id: num(recipient.id),
            ticket_id: num(r.t.id),
            event_date: str(o.occurrence),
            event_id: num(ev.id),
            booking_id: num(child),
            name: str(recipient.name),
            address: str(recipient.email.trim()),
            status: num(1),
            assignment_status: str('assigned'),
            checked_in: num(0),
            created_at: str(wall(at)),
            common_order: str(common),
          });
          continue;
        }
        await w('attendees').add({
          id: num(++attendeeId),
          user_id: num(buyer.id),
          ticket_id: num(r.t.id),
          event_date: str(o.occurrence),
          event_id: num(ev.id),
          booking_id: num(r.id),
          name: str(guest.name),
          phone: str(rng.chance(0.3) ? `+1555${pad(rng.int(0, 9_999_999), 7)}` : null),
          address: str(r.distributable ? buyer.email.trim() : guest.email),
          status: num(1),
          assignment_status: str(r.distributable ? 'unassigned' : 'assigned'),
          checked_in: num(0),
          created_at: str(created),
          common_order: str(common),
        });
      }
      // Check-ins: one row per booking per day (scan day in the platform timezone, time of day in
      // UTC), with an occasional duplicate the legacy app let through.
      if (o.checkedIn && r.isPaid && r.cancel < 2 && !disabled) {
        const local = `${o.occurrence} ${ev.startTime}`;
        const start = wallToInstant(local, tz).ms;
        const scan = start + rng.int(-20, 90) * 60_000;
        const iso = new Date(scan).toISOString();
        const rowsToWrite = rng.chance(0.02) ? 2 : 1;
        for (let k = 0; k < rowsToWrite; k++)
          await w('checkins').add({
            id: num(++checkinId),
            booking_id: num(r.id),
            event_id: num(ev.id),
            event_start_date: str(localDate(scan, tz)),
            check_in_time: str(iso.slice(11, 19)),
            kids_count: num(0),
            user_id: num(null),
            created_at: str(wall(scan)),
            updated_at: str(wall(scan)),
          });
      }
    }
  };

  // A few order_numbers repeat within the instance (the legacy column is not unique): one in 40
  // orders on the small scales, one in 2,000 on the large one.
  const dupEvery = scale.customers >= 10_000 ? 2000 : 40;
  let orderCount = 0;
  for (const ev of events) {
    const isDemo = ev === demoWeekly || ev === demoGala;
    const nOrders = isDemo ? 6 : rng.int(scale.ordersPerEvent[0], scale.ordersPerEvent[1]);
    const past = Date.parse(`${ev.endDate}T00:00:00Z`) < anchorMs;
    const owner = users[ev.ownerId - 1] as UserRow;
    const sellable = ev.tickets.filter((t) => !t.isDonation);
    for (let k = 0; k < nOrders; k++) {
      const buyer = isDemo && k < demoBuyers.length ? (demoBuyers[k] as UserRow) : rng.pick(buyerPool);
      const occurrence = ev.repetitive
        ? (rng.pick(
            ev.occurrences
              .filter((d) => Date.parse(`${d}T00:00:00Z`) < anchorMs + 90 * 86_400_000)
              .slice(-20),
          ) ?? ev.startDate)
        : ev.startDate;
      const lines: Line[] = [];
      const typeCount = rng.chance(0.25) ? 2 : 1;
      for (let i = 0; i < typeCount && i < sellable.length; i++) {
        const t = sellable[(k + i) % sellable.length] as TicketRow;
        lines.push({ ticket: t, qty: rng.int(1, 3), distributable: !isDemo && rng.chance(0.08) });
      }
      const donation = ev.tickets.find((t) => t.isDonation);
      if (donation && rng.chance(0.2)) lines.push({ ticket: donation, qty: 1, distributable: false });
      if (isDemo) {
        lines.length = 0;
        lines.push({ ticket: ev.tickets[0] as TicketRow, qty: k === 0 ? 2 : 1, distributable: false });
      }
      const seq = isDemo ? -1 : orderCount + 1;
      const r = rng.next();
      const gateway =
        seq % 20 === 9 && !ev.free
          ? 'Offline'
          : ev.free
            ? 'Offline'
            : owner.stripeAccount && rng.chance(0.7)
              ? 'Stripe Direct'
              : r < 0.12
                ? 'PayPal'
                : r < 0.22
                  ? 'Offline'
                  : 'Stripe';
      // Cancellations are planted on a fixed rhythm so every status appears at every scale:
      // refunded (3), approved (2), requested (1), and a refund of one row of an order.
      const cancel = seq % 25 === 3 ? 3 : seq % 40 === 11 ? 2 : seq % 50 === 23 ? 1 : 0;
      await writeOrder(ev, buyer, lines, {
        created: isDemo
          ? daysAgo(60 - k)
          : Math.min(
              Date.parse(`${ev.startDate}T12:00:00Z`) - rng.int(1, 60) * 86_400_000,
              anchorMs - rng.int(60, 2000) * 60_000,
            ),
        occurrence: isDemo && ev.repetitive ? '2026-06-02' : occurrence,
        gateway,
        paid: gateway === 'Offline' && !ev.free ? rng.chance(0.5) && seq % 20 !== 9 : true,
        cancel,
        partialRefund: seq % 30 === 14 && lines.reduce((a, l) => a + (l.distributable ? 1 : l.qty), 0) > 1,
        disabled: !isDemo && rng.chance(0.004),
        promo: !isDemo && rng.chance(0.1),
        checkedIn: isDemo ? k === 0 : past && rng.chance(0.65),
        duplicateNumber: !isDemo && ++orderCount % dupEvery === 17,
      });
    }
  }

  // Content: a CMS page (T7 later).
  await w('pages').add({
    id: num(1),
    author_id: num(admin.id),
    title: str('About'),
    body: str(`<p>${SYNTHETIC_MARKER}</p>`),
    slug: str('about'),
    status: str('ACTIVE'),
  });

  // Users last (their table is written first in the dump; rows are only complete now).
  for (const u of users)
    await w('users').add({
      id: num(u.id),
      name: str(u.name),
      first_name: str(u.name.split(' ')[0] ?? null),
      last_name: str(u.name.split(' ').slice(1).join(' ') || null),
      social_links: str(
        users.length >= 400 && u.id % 400 === 5
          ? '{"twitter": @broken'
          : u.id % 4 === 0
            ? JSON.stringify({ website: 'https://example.org/profile' })
            : null,
      ),
      email: str(u.email),
      email_verified_at: str(u.verified),
      password: str(SYNTH_PASSWORD_HASH),
      created_at: str(u.created),
      updated_at: str(u.created),
      stripe_id: str(u.roleId === 2 && u.id % 7 === 0 ? `cus_SYNTH${inst}${pad(u.id, 8)}` : null),
      settings: str('{"locale":"en"}'),
      role_id: num(u.roleId),
      organisation: str(u.organisation),
      phone: str(null),
      status: num(1),
      stripe_account_id: str(u.stripeAccount),
      organizer_id: num(u.organizerId),
      country: str('US'),
    });
  for (const s of subAccounts)
    await w('user_roles').add({ user_id: num(s.id), role_id: num(s.roleId), event_id: num(null) });

  // Emit: header, then each table's structure and data in order.
  const out = new SinkWriter(target);
  await out.write(
    `-- MySQL dump 10.13  Distrib 8.0.46, for Linux (x86_64)\n--\n-- Host: localhost    Database: legacy_${inst}\n-- ------------------------------------------------------\n-- Server version\t8.0.46\n-- ${SYNTHETIC_MARKER}: every name, address, reference and key below is invented (generator: tools/legacy-migrate, instance ${inst}, seed ${opts.seed ?? 20260927}).\n\n/*!40101 SET NAMES utf8mb4 */;\n/*!40103 SET TIME_ZONE='+00:00' */;\n/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;\n\n`,
  );
  const rows: Record<string, number> = {};
  for (const t of SYNTH_TABLES) {
    const tw = w(t.name);
    await tw.flush();
    rows[t.name] = tw.count;
    await out.write(
      `--\n-- Table structure for table \`${t.name}\`\n--\n\nDROP TABLE IF EXISTS \`${t.name}\`;\n${createTableSql(t)}\n`,
    );
    await out.write(`LOCK TABLES \`${t.name}\` WRITE;\n`);
    closeSync(files.get(t.name) as number);
    for await (const chunk of createReadStream(join(spool, `${t.name}.sql`), { encoding: 'utf8' }))
      await out.write(chunk as string);
    await out.write('UNLOCK TABLES;\n\n');
  }
  await out.write('-- Dump completed\n');
  await out.end();
  rmSync(spool, { recursive: true, force: true });
  return { instance: inst, rows, facts };
}

class SinkWriter {
  private readonly target: Writable;
  constructor(target: Writable) {
    this.target = target;
  }
  async write(s: string) {
    if (!this.target.write(s)) await once(this.target, 'drain');
  }
  async end() {
    this.target.end();
    await once(this.target, 'finish');
  }
}

/** Write a dump file (`.sql` or `.sql.gz`). */
export async function generateDumpFile(path: string, opts: SynthOptions): Promise<SynthSummary> {
  const file = createWriteStream(path);
  if (!path.endsWith('.gz')) return generateDump(file, opts);
  const gz = createGzip();
  gz.pipe(file);
  const summary = await generateDump(gz, opts);
  await once(file, 'finish');
  return summary;
}
