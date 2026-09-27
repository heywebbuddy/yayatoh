import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { replayOutput } from '../src/index.ts';

describe('replayOutput (idempotent replay from stored JSON)', () => {
  const Out = z.object({
    id: z.string(),
    at: z.date(),
    label: z.string(),
    nested: z.object({ when: z.date().nullable() }),
    list: z.array(z.object({ t: z.date() })),
  });

  it('turns back into Dates exactly the fields the schema expects as dates', () => {
    const original = {
      id: 'x',
      at: new Date('2029-01-02T03:04:05.678Z'),
      label: '2029-01-02T03:04:05.678Z',
      nested: { when: new Date('2030-01-01T00:00:00Z') },
      list: [{ t: new Date('2031-01-01T00:00:00Z') }],
    };
    const stored = JSON.parse(JSON.stringify(original));
    const r = replayOutput(Out, stored);
    expect(r).toEqual(original);
    // A string field that looks like a date stays a string.
    expect(typeof r.label).toBe('string');
  });

  it('still rejects a stored value that does not fit the schema', () => {
    expect(() => replayOutput(Out, { id: 1 })).toThrow();
    expect(() =>
      replayOutput(Out, { id: 'x', at: 'not a date', label: '', nested: { when: null }, list: [] }),
    ).toThrow();
  });
});
