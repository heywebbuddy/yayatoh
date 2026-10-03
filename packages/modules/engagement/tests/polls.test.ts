import { describe, expect, it } from 'vitest';
import {
  ballotKeys,
  normalizeWord,
  optionsFrom,
  percent,
  pollResults,
  WORDS_SHOWN,
  wordWeight,
} from '../src/domain/polls.ts';

const single = {
  kind: 'single' as const,
  options: optionsFrom(['Yes', 'No']),
  maxChoices: 1,
  ratingScale: null,
};
const multi = {
  kind: 'multi' as const,
  options: optionsFrom(['A', 'B', 'C']),
  maxChoices: 2,
  ratingScale: null,
};
const rating = { kind: 'rating' as const, options: [], maxChoices: 1, ratingScale: 5 };
const cloud = { kind: 'word_cloud' as const, options: [], maxChoices: 1, ratingScale: null };

describe('poll ballots (M5.7a)', () => {
  it('option ids are stable short keys in the entered order', () => {
    expect(optionsFrom([' Yes ', 'No'])).toEqual([
      { id: 'o1', label: 'Yes' },
      { id: 'o2', label: 'No' },
    ]);
  });

  it('single choice: exactly one known option', () => {
    expect(ballotKeys(single, { optionIds: ['o2'] })).toEqual({ keys: ['o2'] });
    expect(ballotKeys(single, {})).toEqual({ problem: 'choose_one' });
    expect(ballotKeys(single, { optionIds: ['o1', 'o2'] })).toEqual({ problem: 'too_many' });
    expect(ballotKeys(single, { optionIds: ['o9'] })).toEqual({ problem: 'unknown_option' });
  });

  it('multiple choice: up to max choices, duplicates collapse', () => {
    expect(ballotKeys(multi, { optionIds: ['o1', 'o3', 'o1'] })).toEqual({ keys: ['o1', 'o3'] });
    expect(ballotKeys(multi, { optionIds: ['o1', 'o2', 'o3'] })).toEqual({ problem: 'too_many' });
  });

  it('rating: a whole number on the scale', () => {
    expect(ballotKeys(rating, { rating: 5 })).toEqual({ keys: ['5'] });
    for (const r of [0, 6, 2.5, undefined])
      expect(ballotKeys(rating, { rating: r })).toEqual({ problem: 'rating' });
  });

  it('word cloud: one normalized word or phrase', () => {
    expect(ballotKeys(cloud, { word: '  Inspiring!! ' })).toEqual({ keys: ['inspiring'] });
    expect(ballotKeys(cloud, { word: '  ?! ' })).toEqual({ problem: 'word' });
  });

  it('normalizes words: case, width, inner spaces, edge punctuation, 40 characters', () => {
    expect(normalizeWord('ＡＩ')).toBe('ai');
    expect(normalizeWord('Machine   Learning.')).toBe('machine learning');
    expect(normalizeWord('«Grüße»')).toBe('grüße');
    expect(normalizeWord('مرحبا')).toBe('مرحبا');
    expect([...normalizeWord('x'.repeat(80))]).toHaveLength(40);
  });
});

describe('poll results (counts only)', () => {
  it('choice results list every option, zeros included, in order', () => {
    expect(pollResults(single, 3, [{ key: 'o2', count: 3 }])).toEqual({
      total: 3,
      counts: [
        { key: 'o1', label: 'Yes', count: 0 },
        { key: 'o2', label: 'No', count: 3 },
      ],
      average: null,
    });
  });

  it('rating results cover the scale and give the mean', () => {
    const r = pollResults(rating, 3, [
      { key: '5', count: 2 },
      { key: '2', count: 1 },
    ]);
    expect(r.counts.map((c) => c.count)).toEqual([0, 1, 0, 0, 2]);
    expect(r.average).toBe(4);
    expect(pollResults(rating, 0, []).average).toBeNull();
  });

  it('word clouds show the most frequent words first, ties alphabetically, capped', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ key: `w${String(i).padStart(2, '0')}`, count: 1 }));
    const r = pollResults(cloud, 90, [{ key: 'zeta', count: 5 }, { key: 'alpha', count: 5 }, ...many]);
    expect(r.counts.slice(0, 3).map((c) => c.key)).toEqual(['alpha', 'zeta', 'w00']);
    expect(r.counts).toHaveLength(WORDS_SHOWN);
  });

  it('weights and percentages', () => {
    expect(wordWeight(10, 10)).toBe(5);
    expect(wordWeight(1, 10)).toBe(1);
    expect(wordWeight(0, 0)).toBe(1);
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBe(0);
  });
});
