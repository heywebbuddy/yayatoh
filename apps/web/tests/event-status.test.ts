import { describe, expect, it } from 'vitest';
import { eventPhase, eventStatusLine } from '../src/lib/event-status.ts';

const NOW = new Date('2026-11-25T12:00:00Z');
const label = {
  status: (s: string) => s,
  phase: (p: string, days: number) => (p === 'planning' ? `${days} days to go` : p),
};
const line = (status: string, start: string, end: string) =>
  eventStatusLine(status, eventPhase(start, end, NOW), label);

describe('eventStatusLine (QA #30)', () => {
  it('an open event shows its status, then its timing', () => {
    expect(line('published', '2026-11-27T18:00:00Z', '2026-11-27T22:00:00Z')).toBe(
      'published · 3 days to go',
    );
    expect(line('draft', '2026-11-23T18:00:00Z', '2026-11-23T22:00:00Z')).toBe('draft · completed');
  });

  it('a postponed, completed, cancelled or archived event shows its status alone', () => {
    for (const status of ['postponed', 'completed', 'cancelled', 'archived'])
      expect(line(status, '2026-11-23T18:00:00Z', '2026-11-23T22:00:00Z')).toBe(status);
  });
});
