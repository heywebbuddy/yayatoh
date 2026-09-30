import { describe, expect, it } from 'vitest';
import { defineStateMachine, reachable } from '../src/index.ts';

const door = defineStateMachine({
  name: 'door',
  states: ['closed', 'open', 'locked'],
  initial: 'closed',
  events: {
    open: { from: ['closed'], to: 'open' },
    close: { from: ['open'], to: 'closed' },
    lock: { from: ['closed'], to: 'locked' },
  },
});

describe('defineStateMachine', () => {
  it('allows declared transitions and rejects the rest with invalid_state', () => {
    expect(door.next('closed', 'open')).toBe('open');
    expect(() => door.next('locked', 'open')).toThrow(expect.objectContaining({ code: 'invalid_state' }));
    expect(door.can('open', 'lock')).toBe(false);
  });
  it('computes reachable states', () => {
    expect([...reachable(door)].sort()).toEqual(['closed', 'locked', 'open']);
    expect([...reachable(door, 'locked')]).toEqual(['locked']);
  });
  it('rejects unknown states at definition time', () => {
    expect(() =>
      defineStateMachine({
        name: 'x',
        states: ['a'],
        initial: 'a',
        events: { go: { from: ['a'], to: 'b' as 'a' } },
      }),
    ).toThrow(/unknown target/);
  });
});
