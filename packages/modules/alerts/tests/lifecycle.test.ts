import { reachable } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import {
  alertLifecycle,
  type Firing,
  planAlert,
  planNotifies,
  type StoredAlert,
  stateAfter,
} from '../src/domain/lifecycle.ts';

const now = new Date('2030-05-01T12:00:00Z');
const firing = (count: number, severity: Firing['severity'] = 'warning'): Firing => ({
  severity,
  count,
  params: { count },
  liveCritical: false,
});
const stored = (over: Partial<StoredAlert> = {}): StoredAlert => ({
  state: 'open',
  severity: 'warning',
  count: 5,
  acknowledgedAt: null,
  snoozedUntil: null,
  ...over,
});
const HOUR = 3_600_000;

describe('alert lifecycle (M3.2b)', () => {
  it('every state is reachable and resolved can only reopen', () => {
    expect([...reachable(alertLifecycle)].sort()).toEqual(['acknowledged', 'open', 'resolved', 'snoozed']);
    expect(alertLifecycle.can('resolved', 'acknowledge')).toBe(false);
    expect(alertLifecycle.can('resolved', 'snooze')).toBe(false);
    expect(alertLifecycle.next('resolved', 'reopen')).toBe('open');
    expect(() => alertLifecycle.next('acknowledged', 'acknowledge')).toThrow();
  });

  it('opens a new alert only when the condition holds', () => {
    expect(planAlert(null, null, now, HOUR)).toEqual({ kind: 'none' });
    expect(planAlert(null, firing(3), now, HOUR)).toEqual({ kind: 'fire' });
  });

  it('resolves automatically from any active state, and never twice', () => {
    for (const state of ['open', 'acknowledged', 'snoozed'] as const)
      expect(
        planAlert(stored({ state, snoozedUntil: state === 'snoozed' ? now : null }), null, now, HOUR),
      ).toEqual({
        kind: 'resolve',
      });
    expect(planAlert(stored({ state: 'resolved' }), null, now, HOUR)).toEqual({ kind: 'none' });
  });

  it('reopens (the same row) when a resolved condition comes back', () => {
    expect(planAlert(stored({ state: 'resolved' }), firing(1), now, HOUR)).toEqual({ kind: 'reopen' });
  });

  it('updates the count quietly, and sends again only when it gets more severe', () => {
    expect(planAlert(stored(), firing(5), now, HOUR)).toEqual({ kind: 'none' });
    const more = planAlert(stored(), firing(9), now, HOUR);
    expect(more).toEqual({ kind: 'update', escalated: false });
    expect(planNotifies(more)).toBe(false);
    const worse = planAlert(stored(), firing(5, 'critical'), now, HOUR);
    expect(worse).toEqual({ kind: 'update', escalated: true });
    expect(planNotifies(worse)).toBe(true);
    expect(planAlert(stored({ severity: 'critical' }), firing(5, 'warning'), now, HOUR)).toEqual({
      kind: 'update',
      escalated: false,
    });
  });

  it('an acknowledgement times out after the timeout while still firing', () => {
    const acked = stored({ state: 'acknowledged', acknowledgedAt: new Date(now.getTime() - 59 * 60_000) });
    expect(planAlert(acked, firing(5), now, HOUR)).toEqual({ kind: 'none' });
    const late = stored({ state: 'acknowledged', acknowledgedAt: new Date(now.getTime() - HOUR) });
    expect(planAlert(late, firing(5), now, HOUR)).toEqual({ kind: 'ackTimeout' });
    // Live-critical: ten minutes.
    const tenMin = stored({ state: 'acknowledged', acknowledgedAt: new Date(now.getTime() - 10 * 60_000) });
    expect(planAlert(tenMin, firing(5), now, 10 * 60_000)).toEqual({ kind: 'ackTimeout' });
    expect(stateAfter('acknowledged', { kind: 'ackTimeout' })).toBe('open');
  });

  it('a snooze holds until its end, then wakes', () => {
    const until = new Date(now.getTime() + 60_000);
    expect(planAlert(stored({ state: 'snoozed', snoozedUntil: until }), firing(5), now, HOUR)).toEqual({
      kind: 'none',
    });
    expect(planAlert(stored({ state: 'snoozed', snoozedUntil: now }), firing(5), now, HOUR)).toEqual({
      kind: 'wake',
    });
    expect(stateAfter('snoozed', { kind: 'wake' })).toBe('open');
  });

  it('sends on fire, reopen, wake and timeout; never on resolve or a plain update', () => {
    for (const kind of ['fire', 'reopen', 'wake', 'ackTimeout'] as const)
      expect(planNotifies({ kind })).toBe(true);
    expect(planNotifies({ kind: 'resolve' })).toBe(false);
    expect(planNotifies({ kind: 'none' })).toBe(false);
  });
});
