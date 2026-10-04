import { describe, expect, it } from 'vitest';
import { wholeEventStatus } from '../src/index.ts';

describe('guest seating occupants (M4.3a)', () => {
  it('derives a guest’s RSVP for the event plan from their sub-event answers', () => {
    // No sub-event invitation yet (or no RSVP at all): pending.
    expect(wholeEventStatus(false, [])).toBe('pending');
    expect(wholeEventStatus(false, [null, null])).toBe('pending');
    // Yes to any sub-event: attending.
    expect(wholeEventStatus(false, ['declined', 'attending'])).toBe('attending');
    // No to every one: declined; no to some, unanswered others: still pending.
    expect(wholeEventStatus(false, ['declined', 'declined'])).toBe('declined');
    expect(wholeEventStatus(false, ['declined', null])).toBe('pending');
    // A gala seat's guest holds a ticket: attending.
    expect(wholeEventStatus(true, [])).toBe('attending');
  });
});
