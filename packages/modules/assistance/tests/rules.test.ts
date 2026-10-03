import { reachable } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import {
  CLOSED_STATES,
  dueAt,
  GUEST_REASONS,
  OPEN_STATES,
  overdue,
  PRIORITY_RANK,
  priorityFor,
  pushes,
  REQUEST_STATES,
  requestLifecycle,
  SLA_MS,
  STAFF_REASONS,
  slaStatus,
} from '../src/domain/rules.ts';

const at = (iso: string) => new Date(iso);

describe('priority rules (M3.3b)', () => {
  it('medical and security are urgent, from guests and staff alike', () => {
    expect(priorityFor('guest', 'medical')).toBe('urgent');
    expect(priorityFor('staff', 'medical')).toBe('urgent');
    expect(priorityFor('staff', 'security')).toBe('urgent');
  });

  it('a guest’s accessibility need is high; seats, lost items and the rest normal', () => {
    expect(priorityFor('guest', 'accessibility')).toBe('high');
    for (const r of ['seat', 'lost_item', 'other'] as const) expect(priorityFor('guest', r)).toBe('normal');
  });

  it('staff asking for backup or a supervisor is high; a device problem normal', () => {
    expect(priorityFor('staff', 'backup')).toBe('high');
    expect(priorityFor('staff', 'supervisor')).toBe('high');
    expect(priorityFor('staff', 'device')).toBe('normal');
  });

  it('every reason has a priority, and only urgent and high are pushed to staff', () => {
    for (const r of GUEST_REASONS) expect(PRIORITY_RANK[priorityFor('guest', r)]).toBeGreaterThanOrEqual(0);
    for (const r of STAFF_REASONS) expect(PRIORITY_RANK[priorityFor('staff', r)]).toBeGreaterThanOrEqual(0);
    expect(pushes('urgent')).toBe(true);
    expect(pushes('high')).toBe(true);
    expect(pushes('normal')).toBe(false);
  });
});

describe('SLA timers', () => {
  it('urgent 2 min, high 5 min, normal 10 min, shorter for more urgent', () => {
    expect(SLA_MS).toEqual({ urgent: 120_000, high: 300_000, normal: 600_000 });
    const t = at('2027-10-14T15:00:00Z');
    expect(dueAt(t, 'urgent').toISOString()).toBe('2027-10-14T15:02:00.000Z');
    expect(dueAt(t, 'high').toISOString()).toBe('2027-10-14T15:05:00.000Z');
    expect(dueAt(t, 'normal').toISOString()).toBe('2027-10-14T15:10:00.000Z');
  });

  it('runs while nobody has taken the request, overdue only after the due time', () => {
    const due = at('2027-10-14T15:02:00Z');
    expect(slaStatus({ state: 'new', dueAt: due }, at('2027-10-14T15:01:00Z'))).toMatchObject({
      running: true,
      remainingMs: 60_000,
      overdue: false,
    });
    expect(slaStatus({ state: 'new', dueAt: due }, at('2027-10-14T15:02:00Z')).overdue).toBe(false);
    expect(slaStatus({ state: 'new', dueAt: due }, at('2027-10-14T15:02:01Z'))).toMatchObject({
      overdue: true,
      remainingMs: -1_000,
    });
    for (const state of ['assigned', 'in_progress', 'resolved', 'cancelled'] as const)
      expect(slaStatus({ state, dueAt: due }, at('2027-10-14T16:00:00Z'))).toMatchObject({
        running: false,
        overdue: false,
      });
  });

  it('overdue() keeps only unassigned requests past their SLA', () => {
    const now = at('2027-10-14T15:30:00Z');
    const rows = [
      { id: 'a', state: 'new' as const, dueAt: at('2027-10-14T15:29:00Z') },
      { id: 'b', state: 'new' as const, dueAt: at('2027-10-14T15:31:00Z') },
      { id: 'c', state: 'assigned' as const, dueAt: at('2027-10-14T15:00:00Z') },
    ];
    expect(overdue(rows, now).map((r) => r.id)).toEqual(['a']);
  });
});

describe('request lifecycle', () => {
  it('new → assigned → in progress → resolved', () => {
    let s = requestLifecycle.initial;
    expect(s).toBe('new');
    s = requestLifecycle.next(s, 'assign');
    expect(s).toBe('assigned');
    s = requestLifecycle.next(s, 'start');
    expect(s).toBe('in_progress');
    s = requestLifecycle.next(s, 'resolve');
    expect(s).toBe('resolved');
  });

  it('a new request can be started at once, resolved or cancelled; reassigning goes back to assigned', () => {
    expect(requestLifecycle.next('new', 'start')).toBe('in_progress');
    expect(requestLifecycle.next('new', 'resolve')).toBe('resolved');
    expect(requestLifecycle.next('assigned', 'cancel')).toBe('cancelled');
    expect(requestLifecycle.next('in_progress', 'assign')).toBe('assigned');
  });

  it('resolved and cancelled are terminal', () => {
    for (const s of CLOSED_STATES)
      for (const e of ['assign', 'start', 'resolve', 'cancel'] as const)
        expect(() => requestLifecycle.next(s, e)).toThrow(/cannot/);
    expect(() => requestLifecycle.next('in_progress', 'start')).toThrow(/cannot/);
  });

  it('every state is reachable and open/closed split the states', () => {
    expect([...reachable(requestLifecycle)].sort()).toEqual([...REQUEST_STATES].sort());
    expect([...OPEN_STATES, ...CLOSED_STATES].sort()).toEqual([...REQUEST_STATES].sort());
  });
});
