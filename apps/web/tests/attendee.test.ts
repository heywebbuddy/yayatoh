import type { GuestOrderDto } from '@yayatoh/orders';
import { describe, expect, it } from 'vitest';
import { attendeeEvents, upcomingOrders } from '../src/lib/attendee.ts';
import { robotsHeader } from '../src/lib/seo/robots.ts';

const now = new Date('2026-10-10T12:00:00Z');
const booking = (eventId: string, starts: string, ends: string, status: GuestOrderDto['status'] = 'paid') =>
  ({
    eventId,
    startsAt: new Date(starts),
    endsAt: new Date(ends),
    status,
  }) as GuestOrderDto;

describe('Attendee booking overview', () => {
  it('includes ongoing events, excludes refunded/cancelled and finished orders, and sorts upcoming dates', () => {
    const ongoing = booking('a', '2026-10-10T11:00:00Z', '2026-10-10T13:00:00Z');
    const future = booking('b', '2026-10-11T11:00:00Z', '2026-10-11T13:00:00Z');
    expect(
      upcomingOrders(
        [
          future,
          booking('c', '2026-10-10', '2026-10-11', 'refunded'),
          booking('d', '2026-10-10', '2026-10-11', 'cancelled'),
          booking('e', '2026-10-09', '2026-10-10T12:00:00Z'),
          ongoing,
        ],
        now,
      ),
    ).toEqual([ongoing, future]);
  });
  it('groups multiple orders for one event without merging different events with the same name', () => {
    const one = booking('a', '2026-10-10', '2026-10-11');
    const another = booking('b', '2026-10-12', '2026-10-13');
    expect(attendeeEvents([another, one, { ...one }])).toEqual([one, another]);
  });
  it('keeps dashboard routes out of search engines on the public host', () => {
    expect(robotsHeader('marketplace', '/attendee')).toBe('noindex, nofollow');
    expect(robotsHeader('marketplace', '/attendee/tickets')).toBe('noindex, nofollow');
  });
});
