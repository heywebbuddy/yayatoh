import { describe, expect, it } from 'vitest';
import { ATTENDEE_IMPORT_TEMPLATE, guessMapping } from '../src/imports.ts';

describe('the attendee import template', () => {
  it('has headers the import recognises', () => {
    expect(guessMapping(ATTENDEE_IMPORT_TEMPLATE.headers)).toEqual({ name: 0, email: 1, labels: 2 });
    for (const r of ATTENDEE_IMPORT_TEMPLATE.rows) expect(r).toHaveLength(3);
  });
});
