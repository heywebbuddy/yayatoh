import { describe, expect, it } from 'vitest';
import { suggestNextEdition } from '../src/lib/series-next.ts';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-10-03T12:00:00Z');

describe('suggestNextEdition (U7)', () => {
  it('is null for a series with no events', () => {
    expect(suggestNextEdition([], NOW)).toBeNull();
  });

  it('one edition: a year later, with the year in the name moved on', () => {
    expect(
      suggestNextEdition([{ name: 'Lake Fest 2027', startsAt: at('2027-06-12T17:00:00Z') }], NOW),
    ).toEqual({
      name: 'Lake Fest 2028',
      startsAt: at('2028-06-12T17:00:00Z'),
    });
  });

  it('several editions: the gap between the last two', () => {
    const s = suggestNextEdition(
      [
        { name: 'Stop 1', startsAt: at('2027-01-05T19:00:00Z') },
        { name: 'Stop 2', startsAt: at('2027-01-12T19:00:00Z') },
      ],
      NOW,
    );
    expect(s).toEqual({ name: 'Stop 2', startsAt: at('2027-01-19T19:00:00Z') });
  });

  it('never suggests a start in the past', () => {
    const s = suggestNextEdition([{ name: 'Gala 2019', startsAt: at('2019-11-20T01:00:00Z') }], NOW);
    expect(s?.startsAt).toEqual(at('2026-11-20T01:00:00Z'));
    expect(s?.name).toBe('Gala 2026');
  });

  it('keeps a year in the name that is not the event year', () => {
    const s = suggestNextEdition(
      [{ name: 'Class of 1999 reunion', startsAt: at('2027-05-01T18:00:00Z') }],
      NOW,
    );
    expect(s?.name).toBe('Class of 1999 reunion');
  });
});
