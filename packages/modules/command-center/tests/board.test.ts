import { PROFILE_KEYS } from '@yayatoh/platform';
import { describe, expect, it } from 'vitest';
import {
  boardSpans,
  CC_ROLES,
  countdown,
  durationParts,
  EVENT_MODES,
  GRID_COLUMNS,
  type HeroAlert,
  KPI_KEYS,
  kpiKeys,
  kpiSpans,
  type NextActionInput,
  nextAction,
  packedRows,
  packSpans,
  packWidths,
  READINESS_FIELDS,
  READINESS_KEYS,
  readinessRules,
  readinessScore,
  resolveLayout,
  WIDGET_META,
  WIDGET_SIZES,
  type WidgetScope,
} from '../src/client.ts';

const ALL_MODULES = new Set(Object.values(WIDGET_META).map((m) => m.module));
const scope = (role: WidgetScope['role'], profile: WidgetScope['profile'] = 'concert'): WidgetScope => ({
  role,
  profile,
  modules: ALL_MODULES,
});

/** Every row of a packed grid is exactly full. */
function expectNoHoles(spans: readonly number[], columns: number) {
  for (const row of packedRows(spans, columns)) expect(row.reduce((a, b) => a + b, 0)).toBe(columns);
}

describe('board packing (U4: no empty cells)', () => {
  it('keeps preferred spans when they tile, and grows the row’s last widget otherwise', () => {
    expect(packSpans(['sm', 'md', 'lg'], 3)).toEqual([1, 2, 3]);
    // The organizer's screenshot: a 2-column readiness card beside nothing.
    expect(packSpans(['md', 'md', 'sm'], 3)).toEqual([3, 2, 1]);
    expect(packSpans(['sm', 'lg'], 3)).toEqual([3, 3]);
    expect(packSpans(['sm', 'sm', 'lg', 'sm'], 3)).toEqual([1, 2, 3, 3]);
    expect(packSpans(['lg', 'md'], 2)).toEqual([2, 2]);
    expect(packSpans(['sm', 'md', 'sm'], 2)).toEqual([2, 2, 2]);
    expect(packSpans(['sm', 'sm', 'sm'], 1)).toEqual([1, 1, 1]);
    expect(packSpans([], 3)).toEqual([]);
  });

  it('never leaves a hole for any order of sizes (exhaustive up to six widgets)', () => {
    const sizes = [...WIDGET_SIZES];
    const all = (n: number): (typeof sizes)[number][][] =>
      n === 0 ? [[]] : all(n - 1).flatMap((rest) => sizes.map((s) => [s, ...rest]));
    for (let n = 0; n <= 6; n++)
      for (const combo of all(n))
        for (const columns of Object.values(GRID_COLUMNS)) {
          const spans = packSpans(combo, columns);
          expect(spans).toHaveLength(combo.length);
          expect(spans.every((s) => s >= 1 && s <= columns)).toBe(true);
          expectNoHoles(spans, columns);
        }
  });

  it('packs every default layout of every role, mode and profile at 390, 1024 and 1440 px', () => {
    for (const role of CC_ROLES)
      for (const mode of EVENT_MODES)
        for (const profile of PROFILE_KEYS) {
          const slots = resolveLayout(WIDGET_META, scope(role, profile), mode, null).filter((s) => !s.hidden);
          const spans = boardSpans(slots.map((s) => s.size));
          for (const bp of ['base', 'md', 'xl'] as const) expectNoHoles(spans[bp], GRID_COLUMNS[bp]);
        }
  });

  it('packs requested widths too, and the KPI row fills its rows', () => {
    expect(packWidths([1, 1, 1], 2)).toEqual([1, 1, 2]);
    expect(packWidths([5], 3)).toEqual([3]);
    for (let n = 1; n <= KPI_KEYS.length; n++) {
      const k = kpiSpans(n);
      expectNoHoles(k.base, Math.min(2, n));
      expectNoHoles(k.md, k.mdColumns);
    }
    expect(kpiSpans(3).base).toEqual([1, 1, 2]);
  });
});

describe('KPI row (U4)', () => {
  it('shows sales, tickets, check-ins and alerts by role; the door never gets sales', () => {
    expect(kpiKeys(WIDGET_META, scope('owner'))).toEqual(['sales', 'tickets', 'checkins', 'alerts']);
    expect(kpiKeys(WIDGET_META, scope('ops'))).toEqual(['sales', 'tickets', 'checkins', 'alerts']);
    expect(kpiKeys(WIDGET_META, scope('finance'))).toEqual(['sales', 'tickets', 'alerts']);
    expect(kpiKeys(WIDGET_META, scope('marketing'))).toEqual(['tickets', 'alerts']);
    expect(kpiKeys(WIDGET_META, scope('door'))).toEqual(['checkins', 'alerts']);
    // Even a registry that wrongly lets the door see sales can't put revenue in its KPI row.
    const leaky = { ...WIDGET_META, sales: { ...WIDGET_META.sales, roles: CC_ROLES } };
    expect(kpiKeys(leaky, scope('door'))).not.toContain('sales');
  });

  it('follows the profile and the modules (a wedding sells nothing)', () => {
    expect(kpiKeys(WIDGET_META, scope('owner', 'wedding'))).toEqual(['checkins', 'alerts']);
    const noReports = {
      ...scope('owner'),
      modules: new Set([...ALL_MODULES].filter((m) => m !== 'reports')),
    };
    expect(kpiKeys(WIDGET_META, noReports)).not.toContain('sales');
  });
});

describe('hero: the next action (U4)', () => {
  const base: NextActionInput = {
    mode: 'planning',
    role: 'owner',
    alerts: [],
    readiness: { blocking: [], todo: [] },
    canScan: true,
    revenue: true,
  };
  const alert = (severity: HeroAlert['severity'], rule = 'sellOut'): HeroAlert => ({
    rule,
    severity,
    count: 3,
    href: '/alerts',
  });
  const item = (key: string) => ({ key, path: 'details', field: 'details-venue' });

  it('puts a critical alert first, then blocking readiness, then warnings', () => {
    const readiness = { blocking: [item('venueSet')], todo: [item('taglineWritten')] };
    expect(
      nextAction({ ...base, readiness, alerts: [alert('warning'), alert('critical', 'paymentsFailed')] }),
    ).toEqual({
      kind: 'alert',
      rule: 'paymentsFailed',
      severity: 'critical',
      count: 3,
      href: '/alerts',
    });
    expect(nextAction({ ...base, readiness, alerts: [alert('warning')] })).toMatchObject({
      kind: 'readiness',
      key: 'venueSet',
      field: 'details-venue',
      blocking: true,
    });
    expect(
      nextAction({
        ...base,
        readiness: { blocking: [], todo: [item('taglineWritten')] },
        alerts: [alert('warning')],
      }),
    ).toMatchObject({
      kind: 'alert',
      severity: 'warning',
    });
    expect(
      nextAction({
        ...base,
        readiness: { blocking: [], todo: [item('taglineWritten')] },
        alerts: [alert('info')],
      }),
    ).toMatchObject({
      kind: 'readiness',
      key: 'taglineWritten',
      blocking: false,
    });
  });

  it('opens the scanner when live, and ignores readiness outside planning and pre-show', () => {
    const readiness = { blocking: [item('venueSet')], todo: [] };
    expect(nextAction({ ...base, mode: 'live', readiness })).toEqual({ kind: 'scanner' });
    expect(nextAction({ ...base, mode: 'live', readiness, canScan: false })).toEqual({ kind: 'none' });
    expect(nextAction({ ...base, mode: 'pre_show', readiness })).toMatchObject({
      kind: 'readiness',
      blocking: true,
    });
  });

  it('ends with the public page before the show and the report after it (money roles only)', () => {
    expect(nextAction(base)).toEqual({ kind: 'publicPage' });
    expect(nextAction({ ...base, role: 'door', readiness: null, alerts: null })).toEqual({ kind: 'none' });
    expect(nextAction({ ...base, mode: 'wrap' })).toEqual({ kind: 'report' });
    expect(nextAction({ ...base, mode: 'wrap', role: 'door', revenue: false })).toEqual({ kind: 'none' });
  });
});

describe('hero: countdown (U4)', () => {
  const w = { startsAt: new Date('2027-06-11T00:00:00Z'), endsAt: new Date('2027-06-11T04:00:00Z') };
  it('counts to the start, then the end, then from the end', () => {
    expect(countdown(w, new Date('2027-06-10T00:00:00Z'))).toEqual({ kind: 'startsIn', at: w.startsAt });
    expect(countdown(w, new Date('2027-06-11T01:00:00Z'))).toEqual({ kind: 'endsIn', at: w.endsAt });
    expect(countdown(w, new Date('2027-06-11T04:00:00Z'))).toEqual({ kind: 'ended', at: w.endsAt });
  });

  it('words a duration in its two largest units', () => {
    const h = 3_600_000;
    expect(durationParts(3 * 24 * h + 4 * h + 59_000)).toEqual([
      { unit: 'day', value: 3 },
      { unit: 'hour', value: 4 },
    ]);
    expect(durationParts(2 * 24 * h + 5 * 60_000)).toEqual([{ unit: 'day', value: 2 }]);
    expect(durationParts(4 * h + 12 * 60_000)).toEqual([
      { unit: 'hour', value: 4 },
      { unit: 'minute', value: 12 },
    ]);
    expect(durationParts(h)).toEqual([{ unit: 'hour', value: 1 }]);
    expect(durationParts(59_000)).toEqual([{ unit: 'minute', value: 0 }]);
    expect(durationParts(-5)).toEqual([{ unit: 'minute', value: 0 }]);
  });
});

describe('readiness checklist (U4)', () => {
  const facts = {
    name: 'Gala',
    status: 'draft',
    startsAt: new Date('2027-06-11T00:00:00Z'),
    endsAt: new Date('2027-06-11T04:00:00Z'),
    venueName: null,
    attendanceMode: 'in_person' as const,
    tagline: null,
    descriptionSections: 0,
    upcomingDates: 0,
    totalDates: 0,
    ticketTypes: 0,
    sessions: 0,
    speakers: 1,
    nav: new Set(['ticketsOrders', 'sessions', 'speakers']),
    now: new Date('2027-06-01T00:00:00Z'),
  };

  it('names a field for every key that has one, and every rule carries it', () => {
    expect(Object.keys(READINESS_FIELDS).sort()).toEqual([...READINESS_KEYS].sort());
    for (const r of readinessRules(facts))
      expect(r.field).toBe(READINESS_FIELDS[r.key as keyof typeof READINESS_FIELDS]);
    expect(readinessRules(facts).find((r) => r.key === 'venueSet')).toMatchObject({
      path: 'details',
      field: 'details-venue',
    });
  });

  it('lists every counted item in rule order, done or not, blocking ones marked', () => {
    const s = readinessScore(readinessRules(facts));
    expect(s.items.map((i) => [i.key, i.done, i.blocking])).toEqual([
      ['detailsAdded', true, true],
      ['venueSet', false, true],
      ['taglineWritten', false, false],
      ['descriptionAdded', false, false],
      ['datesUpcoming', true, true],
      ['ticketsCreated', false, true],
      ['agendaAdded', false, false],
      ['speakersAdded', true, false],
      ['published', false, true],
    ]);
    // "Coming soon" items never show in the checklist.
    const wedding = readinessScore(
      readinessRules({ ...facts, checklist: ['guestsAdded', 'rsvpDeadlineSet'] }),
    );
    expect(wedding.items.map((i) => i.key)).toContain('guestsAdded');
    expect(wedding.items.map((i) => i.key)).not.toContain('rsvpDeadlineSet');
  });
});
