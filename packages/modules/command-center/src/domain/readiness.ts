/**
 * Readiness engine v1 (roadmap M1.4 "three-screen wizard and readiness engine v1", extended in
 * M1.4f; moved here from the web app in M3.2 for the Command Center's readiness score): rules
 * computed from facts about the event. Pure, so the console, the wizard's
 * checklist and the tests share it. Each rule names the console page that fixes it (`path`,
 * relative to the event, '' = the event home with the publish button).
 *
 * Rules only apply when the profile shows the matching section: a wedding (no tickets page) is
 * never asked for tickets, a concert never for speakers (profile-driven, no code per profile).
 */
export interface ReadinessFacts {
  readonly name: string;
  readonly status: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly venueName: string | null;
  readonly attendanceMode: 'in_person' | 'online' | 'hybrid';
  readonly tagline: string | null;
  /** Visible text sections (the event description). */
  readonly descriptionSections: number;
  /** Scheduled dates of a multi-date event (0 = a single-date event). */
  readonly upcomingDates: number;
  readonly totalDates: number;
  readonly ticketTypes: number;
  readonly sessions: number;
  readonly speakers: number;
  /** Nav keys the event's profile shows (with the org's modules). */
  readonly nav: ReadonlySet<string>;
  readonly now: Date;
}

export interface ReadinessRule {
  readonly key: string;
  readonly done: boolean;
  readonly path: string;
}

export const READINESS_KEYS = [
  'detailsAdded',
  'venueSet',
  'taglineWritten',
  'descriptionAdded',
  'datesUpcoming',
  'ticketsCreated',
  'agendaAdded',
  'speakersAdded',
  'published',
] as const;

export function readinessRules(f: ReadinessFacts): ReadinessRule[] {
  const rules: ReadinessRule[] = [
    { key: 'detailsAdded', done: f.name.trim().length > 0 && f.endsAt > f.startsAt, path: '' },
    { key: 'venueSet', done: Boolean(f.venueName) || f.attendanceMode === 'online', path: 'details' },
    { key: 'taglineWritten', done: Boolean(f.tagline?.trim()), path: 'content' },
    { key: 'descriptionAdded', done: f.descriptionSections > 0, path: 'content' },
    {
      key: 'datesUpcoming',
      done: f.totalDates > 0 ? f.upcomingDates > 0 : f.endsAt > f.now,
      path: 'dates',
    },
  ];
  if (f.nav.has('ticketsOrders'))
    rules.push({ key: 'ticketsCreated', done: f.ticketTypes > 0, path: 'tickets-orders' });
  if (f.nav.has('sessions')) rules.push({ key: 'agendaAdded', done: f.sessions > 0, path: 'sessions' });
  if (f.nav.has('speakers')) rules.push({ key: 'speakersAdded', done: f.speakers > 0, path: 'speakers' });
  rules.push({
    key: 'published',
    done: ['published', 'postponed', 'completed'].includes(f.status),
    path: '',
  });
  return rules;
}

/** Share of rules done, 0–100. */
export function readinessPercent(rules: readonly ReadinessRule[]): number {
  return rules.length === 0 ? 100 : Math.round((rules.filter((r) => r.done).length / rules.length) * 100);
}

/**
 * Rules that block selling or running the event (M3.2 readiness score): without them the event
 * can't be found, bought or attended. The others make it better but don't stop it.
 */
export const BLOCKING_READINESS_KEYS: readonly (typeof READINESS_KEYS)[number][] = [
  'detailsAdded',
  'venueSet',
  'datesUpcoming',
  'ticketsCreated',
  'published',
];

export interface ReadinessScore {
  /** 0–100: blocking rules weigh twice as much as the others. */
  readonly score: number;
  readonly done: number;
  readonly total: number;
  /** Blocking rules not done yet, in rule order, each with the page that fixes it. */
  readonly blocking: readonly ReadinessRule[];
  /** Other rules not done yet. */
  readonly todo: readonly ReadinessRule[];
}

export function readinessScore(rules: readonly ReadinessRule[]): ReadinessScore {
  const weight = (r: ReadinessRule) => ((BLOCKING_READINESS_KEYS as readonly string[]).includes(r.key) ? 2 : 1);
  const total = rules.reduce((s, r) => s + weight(r), 0);
  const done = rules.reduce((s, r) => s + (r.done ? weight(r) : 0), 0);
  const open = rules.filter((r) => !r.done);
  return {
    score: total === 0 ? 100 : Math.round((done / total) * 100),
    done: rules.filter((r) => r.done).length,
    total: rules.length,
    blocking: open.filter((r) => weight(r) === 2),
    todo: open.filter((r) => weight(r) === 1),
  };
}
