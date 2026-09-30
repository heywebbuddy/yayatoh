import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { partialNoDefaults } from '../src/index.ts';

describe('partialNoDefaults', () => {
  const Create = z.object({
    name: z.string(),
    currency: z.string().default('USD'),
    note: z.string().nullable().default(null),
  });

  it('keeps only the fields the caller sent (plain .partial() would fill in defaults)', () => {
    expect(Create.partial().parse({ name: 'x' })).toEqual({ name: 'x', currency: 'USD', note: null });
    expect(partialNoDefaults(Create).parse({ name: 'x' })).toEqual({ name: 'x' });
    expect(partialNoDefaults(Create).parse({ currency: 'EUR' })).toEqual({ currency: 'EUR' });
  });

  it('still validates the fields that are present', () => {
    expect(() => partialNoDefaults(Create).parse({ name: 1 })).toThrow();
  });
});
