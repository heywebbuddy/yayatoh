import { describe, expect, it } from 'vitest';
import { checkinBps, liveCount, nextEvent, reportTotals } from '../src/domain.ts';

const now = new Date('2026-10-03T12:00:00Z');
const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
const ev = (name: string, status: string, start: number, end: number) => ({
  name,
  status,
  startsAt: at(start),
  endsAt: at(end),
});

describe('agency pages: pure rules', () => {
  it('the next event is the soonest not-cancelled event that has not started', () => {
    const events = [
      ev('Running', 'published', -1, 2),
      ev('Cancelled', 'cancelled', 1, 3),
      ev('Later', 'published', 48, 50),
      ev('Soon draft', 'draft', 5, 6),
    ];
    expect(nextEvent(events, now)?.name).toBe('Soon draft');
    expect(nextEvent([ev('Past', 'completed', -10, -8)], now)).toBeNull();
  });

  it('counts published events running now as live', () => {
    expect(liveCount([ev('a', 'published', -1, 1), ev('b', 'draft', -1, 1), ev('c', 'published', 1, 2)], now)).toBe(1);
  });

  it('check-in rate in basis points, capped and zero-safe', () => {
    expect(checkinBps(0, 0)).toBe(0);
    expect(checkinBps(1, 3)).toBe(3333);
    expect(checkinBps(5, 4)).toBe(10_000);
  });

  it('report totals add counts, and money per currency over finance clients only', () => {
    const row = {
      eventsTotal: 2,
      eventsUpcoming: 1,
      ordersSold: 3,
      ticketsValid: 4,
      checkins: 2,
      sends: 10,
      clicks: 5,
    };
    const t = reportTotals([
      { ...row, revenue: { USD: 1000, EUR: 50 } },
      { ...row, revenue: null },
      { ...row, revenue: { USD: 500 } },
    ]);
    expect(t).toMatchObject({
      clients: 3,
      eventsTotal: 6,
      ordersSold: 9,
      ticketsValid: 12,
      checkins: 6,
      checkinBps: 5000,
      sends: 30,
      clicks: 15,
      financeClients: 2,
    });
    expect(t.revenue).toEqual({ USD: 1500, EUR: 50 });
    expect(reportTotals([]).revenue).toEqual({});
  });
});
