import { describe, expect, it } from 'vitest';
import { allocateCredit } from '../src/domain/credit.ts';
import { decideTransfer, type TransferRules, transferDeadline } from '../src/domain/transfer-rules.ts';

const rules = (over: Partial<TransferRules> = {}): TransferRules => ({
  transfersAllowed: true,
  transferCutoffHours: null,
  transferFeeMinor: 0,
  ...over,
});
const startsAt = new Date('2027-10-14T18:00:00Z');
const endsAt = new Date('2027-10-14T23:00:00Z');
const at = (iso: string, by: 'organizer' | 'holder' = 'holder', ticketActive = true) => ({
  now: new Date(iso),
  startsAt,
  endsAt,
  ticketActive,
  by,
});

describe('transfer rules (M3.10c)', () => {
  it('lets a holder transfer for free until the event ends by default', () => {
    expect(transferDeadline(rules(), startsAt, endsAt)).toEqual(endsAt);
    expect(decideTransfer(rules(), at('2027-10-14T20:00:00Z'))).toEqual({ ok: true, feeMinor: 0 });
    expect(decideTransfer(rules(), at('2027-10-14T23:00:00Z'))).toEqual({ ok: false, reason: 'event_ended' });
  });

  it('closes holder transfers the cutoff hours before the start and reports the deadline', () => {
    const r = rules({ transferCutoffHours: 48 });
    expect(transferDeadline(r, startsAt, endsAt)).toEqual(new Date('2027-10-12T18:00:00Z'));
    expect(decideTransfer(r, at('2027-10-12T17:00:00Z')).ok).toBe(true);
    expect(decideTransfer(r, at('2027-10-12T18:00:00Z'))).toEqual({
      ok: false,
      reason: 'deadline_passed',
      deadline: new Date('2027-10-12T18:00:00Z'),
    });
  });

  it('charges the ticket type fee in minor units to holders', () => {
    expect(decideTransfer(rules({ transferFeeMinor: 350 }), at('2027-10-01T00:00:00Z'))).toEqual({
      ok: true,
      feeMinor: 350,
    });
  });

  it('refuses holders when transfers are off for the type', () => {
    expect(decideTransfer(rules({ transfersAllowed: false }), at('2027-10-01T00:00:00Z'))).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
  });

  it('lets organizers transfer past the holder rules, for free, until the event ends', () => {
    const strict = rules({ transfersAllowed: false, transferCutoffHours: 72, transferFeeMinor: 500 });
    expect(decideTransfer(strict, at('2027-10-14T20:00:00Z', 'organizer'))).toEqual({
      ok: true,
      feeMinor: 0,
    });
    expect(decideTransfer(strict, at('2027-10-14T23:00:00Z', 'organizer'))).toEqual({
      ok: false,
      reason: 'event_ended',
    });
  });

  it('never transfers a void ticket', () => {
    expect(decideTransfer(rules(), at('2027-10-01T00:00:00Z', 'organizer', false))).toEqual({
      ok: false,
      reason: 'ticket_void',
    });
  });
});

describe('store credit allocation on a cart (M3.10c)', () => {
  const line = (unitNetMinor: number, quantity: number, eligible = true) => ({
    unitNetMinor,
    quantity,
    eligible,
  });

  it('takes the same amount off every ticket of a line and never more than the budget', () => {
    expect(allocateCredit([line(2500, 3)], 1000)).toEqual([333]);
    expect(allocateCredit([line(2500, 2)], 1000)).toEqual([500]);
  });

  it('never takes a ticket below zero and serves dearer lines first', () => {
    expect(allocateCredit([line(1000, 1), line(3000, 1)], 10_000)).toEqual([1000, 3000]);
    expect(allocateCredit([line(1000, 1), line(3000, 1)], 3500)).toEqual([500, 3000]);
  });

  it('skips donations, free lines and an empty budget', () => {
    expect(allocateCredit([line(2000, 1, false), line(0, 2), line(1500, 1)], 5000)).toEqual([0, 0, 1500]);
    expect(allocateCredit([line(1500, 1)], 0)).toEqual([0]);
    expect(allocateCredit([line(1500, 1)], -5)).toEqual([0]);
  });

  it('leaves what cannot be split evenly (the rest stays on the note)', () => {
    const units = allocateCredit([line(900, 4)], 10);
    expect(units).toEqual([2]);
    expect(10 - (units[0] ?? 0) * 4).toBe(2);
  });
});
