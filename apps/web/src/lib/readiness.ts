/**
 * Readiness engine v1 (roadmap M1.4 "three-screen wizard and readiness engine v1", extended in
 * M1.4f): rules computed from facts about the event. Pure, so the console, the wizard's
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
  /** M4.2a: the profile's own checklist items (`Profile.checklist`). */
  readonly checklist?: readonly string[];
  /** M4.2a: the event has a floor plan (a seating layout). */
  readonly floorPlan?: boolean;
  /** M4.1a: guests on the event's guest list (placeholder plus-ones included). */
  readonly guests?: number;
  readonly now: Date;
}

export interface ReadinessRule {
  readonly key: string;
  readonly done: boolean;
  readonly path: string;
  /**
   * M4.2a: the page that fixes it is a placeholder (the feature is not built yet): the item is
   * shown as "coming soon", links to that placeholder and never counts toward readiness.
   */
  readonly comingSoon?: boolean;
}

/**
 * Event sections that are placeholder pages for now (`[section]`: "coming soon"). A milestone that
 * builds one removes it here and gives its checklist item a real fact. `apps/web/tests/readiness`
 * checks the list against the routes on disk.
 */
export const PLACEHOLDER_SECTIONS = [
  'rsvp',
  'website',
  'gallery',
  'messages',
  'day-of',
  'tables-sponsors',
  'branding',
  'donations',
  'registration',
  'communications',
  'libraries',
] as const;

/** Profile checklist items (M4.2a): each names the page that fixes it and, once built, its fact. */
const PROFILE_ITEMS: Readonly<Record<string, { path: string; done: (f: ReadinessFacts) => boolean }>> = {
  guestsAdded: { path: 'guests', done: (f) => (f.guests ?? 0) > 0 },
  rsvpDeadlineSet: { path: 'rsvp', done: () => false },
  floorPlanChosen: { path: 'seating', done: (f) => f.floorPlan === true },
  guestSitePublished: { path: 'website', done: () => false },
  tablesSponsors: { path: 'tables-sponsors', done: () => false },
};

export const READINESS_KEYS = [
  'detailsAdded',
  'venueSet',
  'taglineWritten',
  'descriptionAdded',
  'datesUpcoming',
  'ticketsCreated',
  'agendaAdded',
  'speakersAdded',
  'guestsAdded',
  'rsvpDeadlineSet',
  'floorPlanChosen',
  'guestSitePublished',
  'tablesSponsors',
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
  for (const key of f.checklist ?? []) {
    const item = PROFILE_ITEMS[key];
    if (!item) continue;
    const comingSoon = (PLACEHOLDER_SECTIONS as readonly string[]).includes(item.path);
    rules.push({
      key,
      done: !comingSoon && item.done(f),
      path: item.path,
      ...(comingSoon ? { comingSoon } : {}),
    });
  }
  rules.push({
    key: 'published',
    done: ['published', 'postponed', 'completed'].includes(f.status),
    path: '',
  });
  return rules;
}

/** Share of rules done, 0–100. "Coming soon" items don't count (M4.2a). */
export function readinessPercent(rules: readonly Pick<ReadinessRule, 'done' | 'comingSoon'>[]): number {
  const counted = rules.filter((r) => !r.comingSoon);
  return counted.length === 0
    ? 100
    : Math.round((counted.filter((r) => r.done).length / counted.length) * 100);
}
