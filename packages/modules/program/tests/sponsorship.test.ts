import { describe, expect, it } from 'vitest';
import {
  dueAtFromDate,
  dueDateOf,
  isCalendarDate,
  isOverdue,
  leadLicenseAllowance,
  overdueDeliverables,
  packagesLeft,
  seatUse,
  snapshotAllowances,
  staffAllowanceWithPackages,
  templateDueAt,
} from '../src/domain/sponsorship.ts';

const NY = 'America/New_York';
const TOKYO = 'Asia/Tokyo';

describe('package allowances (M5.4b)', () => {
  it('a grant snapshots exactly the package’s allowances', () => {
    const gold = {
      compRegistrations: 10,
      exhibitorBadges: 4,
      leadLicenses: 3,
      logoPlacements: ['stage', 'website', 'stage'],
      sessionSlots: 1,
    };
    expect(snapshotAllowances(gold)).toEqual({
      compRegistrations: 10,
      exhibitorBadges: 4,
      leadLicenses: 3,
      logoPlacements: ['stage', 'website'],
      sessionSlots: 1,
    });
  });

  it('staff badges add up: base plus every active package', () => {
    expect(staffAllowanceWithPackages(5, [])).toBe(5);
    expect(staffAllowanceWithPackages(5, [4])).toBe(9);
    expect(staffAllowanceWithPackages(0, [4, 2])).toBe(6);
  });

  it('lead licenses: included + packages + purchased add-ons (P5-4)', () => {
    expect(leadLicenseAllowance({ included: 1, fromPackages: [], purchased: [] })).toBe(1);
    expect(leadLicenseAllowance({ included: 1, fromPackages: [3], purchased: [2, 1] })).toBe(7);
    expect(leadLicenseAllowance({ included: 0, fromPackages: [], purchased: [] })).toBe(0);
  });

  it('seats left never go negative', () => {
    expect(seatUse(3, 1)).toEqual({ allowance: 3, used: 1, left: 2 });
    expect(seatUse(1, 3)).toEqual({ allowance: 1, used: 3, left: 0 });
  });

  it('packages left: active and still-held purchases take a place; lapsed holds do not', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    const later = new Date('2026-10-01T12:10:00Z');
    const earlier = new Date('2026-10-01T11:50:00Z');
    expect(packagesLeft(null, [{ status: 'active', holdUntil: null }], now)).toBeNull();
    expect(
      packagesLeft(
        3,
        [
          { status: 'active', holdUntil: null },
          { status: 'pending', holdUntil: later },
          { status: 'pending', holdUntil: earlier },
          { status: 'cancelled', holdUntil: null },
        ],
        now,
      ),
    ).toBe(1);
    expect(packagesLeft(1, [{ status: 'active', holdUntil: null }, { status: 'active', holdUntil: null }], now)).toBe(0);
  });
});

describe('deliverable due dates in the event’s time zone (M5.4b)', () => {
  it('validates calendar dates', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-2-3')).toBe(false);
  });

  it('due on a date = due by the end of that day where the event is', () => {
    // New York in October is UTC-4: the end of Oct 10 is 04:00Z on Oct 11.
    expect(dueAtFromDate('2026-10-10', NY).toISOString()).toBe('2026-10-11T04:00:00.000Z');
    // Tokyo is UTC+9: the end of Oct 10 is 15:00Z on Oct 10.
    expect(dueAtFromDate('2026-10-10', TOKYO).toISOString()).toBe('2026-10-10T15:00:00.000Z');
    // The day DST ends in New York (Nov 1, 2026) still ends at midnight local (UTC-5 then).
    expect(dueAtFromDate('2026-11-01', NY).toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(dueDateOf(dueAtFromDate('2026-10-10', NY), NY)).toBe('2026-10-10');
    expect(dueDateOf(dueAtFromDate('2026-11-01', NY), NY)).toBe('2026-11-01');
  });

  it('template due dates count back from the event’s first day in its zone', () => {
    // Starts 01:00 Tokyo on Oct 20 (16:00Z Oct 19): the first day is Oct 20 there.
    const start = new Date('2026-10-19T16:00:00Z');
    expect(dueDateOf(templateDueAt(start, 14, TOKYO), TOKYO)).toBe('2026-10-06');
    expect(dueDateOf(templateDueAt(start, 0, TOKYO), TOKYO)).toBe('2026-10-20');
  });

  it('overdue: open and past the end of the due day; done never is', () => {
    const due = dueAtFromDate('2026-10-10', NY);
    const open = { status: 'open', dueAt: due };
    expect(isOverdue(open, new Date('2026-10-11T03:59:59.999Z'))).toBe(false);
    expect(isOverdue(open, new Date('2026-10-11T04:00:00.000Z'))).toBe(true);
    expect(isOverdue({ status: 'done', dueAt: due }, new Date('2027-01-01T00:00:00Z'))).toBe(false);
  });

  it('lists exactly the overdue ones, most overdue first, stable', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const d = (id: string, title: string, date: string, status = 'open') => ({
      id,
      title,
      status,
      dueAt: dueAtFromDate(date, NY),
    });
    const list = [
      d('1', 'Logo files', '2026-10-12'),
      d('2', 'Banner proof', '2026-10-09'),
      d('3', 'Booth staff names', '2026-10-15'),
      d('4', 'Ad copy', '2026-10-12'),
      d('5', 'Invoice', '2026-10-01', 'done'),
      d('6', 'Slides', '2026-10-20'),
    ];
    expect(overdueDeliverables(list, now).map((x) => x.id)).toEqual(['2', '4', '1']);
  });
});
