import { describe, expect, it } from 'vitest';
import {
  guestFullName,
  mayResend,
  namingRefusal,
  pickSlot,
  REMINDER_GAP_MS,
  RESEND_GAP_MS,
  refundUnits,
  tableProgress,
} from '../src/domain/tables.ts';

/** M4.2b gala tables: the pure rules of naming a purchased table's guest slots. */
const now = new Date('2027-11-01T12:00:00Z');
const later = new Date('2027-11-20T05:00:00Z');

describe('naming a table', () => {
  it('is open for paid (or partly refunded) orders until the event ends', () => {
    expect(namingRefusal('paid', later, now)).toBeNull();
    expect(namingRefusal('partially_refunded', later, now)).toBeNull();
    for (const s of ['reserved', 'awaiting_payment', 'refunded', 'cancelled', 'expired'])
      expect(namingRefusal(s, later, now)).toBe('not_paid');
    expect(namingRefusal('paid', now, now)).toBe('event_over');
    expect(namingRefusal('paid', new Date(now.getTime() - 1), now)).toBe('event_over');
  });

  it('picks the asked-for slot only when it is this table’s and unnamed, else the first free one', () => {
    const slots = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(pickSlot(slots, new Set(), null)).toBe('a');
    expect(pickSlot(slots, new Set(['a']), null)).toBe('b');
    expect(pickSlot(slots, new Set(['a']), 'c')).toBe('c');
    expect(pickSlot(slots, new Set(['a']), 'a')).toBeNull();
    expect(pickSlot(slots, new Set(), 'z')).toBeNull();
    expect(pickSlot(slots, new Set(['a', 'b', 'c']), null)).toBeNull();
  });

  it('counts named and missing seats, never more named than slots', () => {
    expect(tableProgress(10, 0)).toEqual({ named: 0, missing: 10 });
    expect(tableProgress(10, 4)).toEqual({ named: 4, missing: 6 });
    expect(tableProgress(10, 12)).toEqual({ named: 10, missing: 0 });
    expect(tableProgress(0, 0)).toEqual({ named: 0, missing: 0 });
  });

  it('throttles resends and reminders', () => {
    expect(mayResend(null, now, RESEND_GAP_MS)).toBe(true);
    expect(mayResend(new Date(now.getTime() - 30_000), now, RESEND_GAP_MS)).toBe(false);
    expect(mayResend(new Date(now.getTime() - RESEND_GAP_MS), now, RESEND_GAP_MS)).toBe(true);
    expect(mayResend(new Date(now.getTime() - 59 * 60_000), now, REMINDER_GAP_MS)).toBe(false);
    expect(mayResend(new Date(now.getTime() - 60 * 60_000), now, REMINDER_GAP_MS)).toBe(true);
  });

  it('writes the guest’s full name', () => {
    expect(guestFullName(' Ada ', ' Lovelace ')).toBe('Ada Lovelace');
    expect(guestFullName('Ada', null)).toBe('Ada');
    expect(guestFullName('Ada', '')).toBe('Ada');
  });
});

describe('refunding by tickets', () => {
  const live = [
    { id: 't1', tableUnitId: 'u1' },
    { id: 't2', tableUnitId: 'u1' },
    { id: 'g1', tableUnitId: null },
    { id: 'g2', tableUnitId: null },
  ];

  it('pays an ordinary ticket each, and a table once when all its live seats are chosen', () => {
    expect(refundUnits([live[2], live[3]] as typeof live, live).map((t) => t.id)).toEqual(['g1', 'g2']);
    expect(refundUnits([live[0], live[1], live[2]] as typeof live, live).map((t) => t.id)).toEqual([
      't1',
      'g1',
    ]);
  });

  it('refuses part of a table', () => {
    expect(refundUnits([live[0]] as typeof live, live)).toBeNull();
    // Seats already refunded are not live: the rest of the table is the whole of it.
    expect(refundUnits([live[1]] as typeof live, live.slice(1)).map((t) => t.id)).toEqual(['t2']);
  });
});
