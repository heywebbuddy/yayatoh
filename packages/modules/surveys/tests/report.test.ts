import { describe, expect, it } from 'vitest';
import { answerCell, npsOf, responseRate, roundHalfAway, summarizeQuestion } from '../src/domain/report.ts';

describe('NPS', () => {
  it('buckets 9–10 as promoters, 7–8 passives, 0–6 detractors', () => {
    const r = npsOf([10, 9, 8, 7, 6, 0]);
    expect(r).toMatchObject({ answered: 6, promoters: 2, passives: 2, detractors: 2, score: 0 });
    expect(r.distribution).toEqual([1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
  });

  it('is %promoters − %detractors, from −100 to 100', () => {
    expect(npsOf([10, 10, 10]).score).toBe(100);
    expect(npsOf([0, 3, 6]).score).toBe(-100);
    expect(npsOf([7, 8]).score).toBe(0);
    // 5 promoters, 2 passives, 3 detractors of 10 → 50 − 30 = 20
    expect(npsOf([9, 9, 10, 10, 9, 7, 8, 1, 2, 6]).score).toBe(20);
  });

  it('rounds half away from zero', () => {
    // 1 promoter, 7 others passive of 8 → 12.5 → 13; mirrored → −13
    expect(npsOf([9, 7, 7, 7, 7, 7, 7, 7]).score).toBe(13);
    expect(npsOf([0, 7, 7, 7, 7, 7, 7, 7]).score).toBe(-13);
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway(2.4)).toBe(2);
  });

  it('has no score without answers and ignores out-of-range values', () => {
    expect(npsOf([]).score).toBeNull();
    expect(npsOf([11, -1, 3.5]).answered).toBe(0);
  });
});

describe('response rate', () => {
  it('is a whole percent of the people asked', () => {
    expect(responseRate(1, 3)).toBe(33);
    expect(responseRate(2, 3)).toBe(67);
    expect(responseRate(3, 3)).toBe(100);
    expect(responseRate(0, 0)).toBeNull();
    expect(responseRate(0, 5)).toBe(0);
  });
});

describe('question summaries', () => {
  const answers = [
    { nps: 10, stars: 5, topic: 'food', tags: ['a', 'b'], again: true, n: 2, note: 'Great' },
    { nps: 6, stars: 4, topic: 'music', tags: ['b'], again: false, n: 3, note: 'Too loud' },
    { stars: 4 },
  ];
  it('ratings: average to one decimal and a 1–5 distribution', () => {
    expect(summarizeQuestion({ key: 'stars', type: 'rating', options: {} }, answers)).toEqual({
      kind: 'rating',
      answered: 3,
      average: 4.3,
      distribution: [0, 0, 0, 2, 1],
    });
  });
  it('choices: counts per option, in the definition order, with labels', () => {
    const q = { key: 'tags', type: 'multi_select', options: { a: 'Alpha', b: 'Beta', c: 'Gamma' } };
    expect(summarizeQuestion(q, answers)).toEqual({
      kind: 'choice',
      answered: 2,
      options: [
        { value: 'a', label: 'Alpha', count: 1 },
        { value: 'b', label: 'Beta', count: 2 },
        { value: 'c', label: 'Gamma', count: 0 },
      ],
    });
  });
  it('checkbox, number and text', () => {
    expect(summarizeQuestion({ key: 'again', type: 'checkbox', options: {} }, answers)).toEqual({
      kind: 'checkbox',
      answered: 2,
      yes: 1,
    });
    expect(summarizeQuestion({ key: 'n', type: 'count', options: {} }, answers)).toEqual({
      kind: 'number',
      answered: 2,
      average: 2.5,
      min: 2,
      max: 3,
    });
    expect(summarizeQuestion({ key: 'note', type: 'long_text', options: {} }, answers)).toEqual({
      kind: 'text',
      answered: 2,
      latest: ['Too loud', 'Great'],
    });
  });
  it('NPS questions summarize as NPS', () => {
    expect(summarizeQuestion({ key: 'nps', type: 'nps', options: {} }, answers)).toMatchObject({
      kind: 'nps',
      answered: 2,
      score: 0,
    });
  });
});

describe('CSV cells', () => {
  const words = { yes: 'Yes', no: 'No' };
  it('shows choice labels, yes/no words and numbers', () => {
    const q = { key: 't', type: 'select', options: { food: 'Food' } };
    expect(answerCell(q, 'food', words)).toBe('Food');
    expect(answerCell({ ...q, type: 'multi_select' }, ['food', 'x'], words)).toBe('Food; x');
    expect(answerCell({ key: 'c', type: 'checkbox', options: {} }, false, words)).toBe('No');
    expect(answerCell({ key: 'n', type: 'nps', options: {} }, 9, words)).toBe('9');
    expect(answerCell({ key: 'n', type: 'nps', options: {} }, undefined, words)).toBe('');
  });
});
