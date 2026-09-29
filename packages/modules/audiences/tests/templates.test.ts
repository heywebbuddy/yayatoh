import { SegmentDefinition } from '@yayatoh/crm/client';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_KEYS, TEMPLATE_PARAMS, templateDefinition } from '../src/domain/templates.ts';

const E = '0190a3f0-0000-7000-8000-000000000001';
const T = '0190a3f0-0000-7000-8000-0000000000a1';

describe('vision audience templates', () => {
  it('every template builds a valid definition that round-trips through the DSL', () => {
    for (const key of TEMPLATE_KEYS) {
      const d = templateDefinition(key, { eventId: E, ticketTypeIds: [T] });
      expect(SegmentDefinition.parse(d)).toEqual(d);
      expect(TEMPLATE_PARAMS[key]).toContain('eventId');
    }
  });

  it('VIPs without seats: holders of the chosen types at the event, unseated', () => {
    const d = templateDefinition('vipsWithoutSeats', { eventId: E, ticketTypeIds: [T] });
    expect(d.root.conditions).toEqual([
      expect.objectContaining({ scope: { kind: 'event', eventId: E }, ticketTypeIds: [T], seated: false }),
    ]);
  });

  it("last year's attendees not registered this year: series-relative", () => {
    const d = templateDefinition('lastYearNotThisYear', { eventId: E });
    expect(d.root).toMatchObject({
      op: 'and',
      conditions: [
        { scope: { kind: 'previousEdition', eventId: E }, checkedIn: true, negate: false },
        { scope: { kind: 'event', eventId: E }, negate: true },
      ],
    });
  });

  it('registered but not checked in', () => {
    const d = templateDefinition('registeredNotCheckedIn', { eventId: E });
    expect(d.root.conditions).toEqual([expect.objectContaining({ role: 'attendee', checkedIn: false })]);
  });
});
