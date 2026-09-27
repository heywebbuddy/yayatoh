import { describe, expect, it } from 'vitest';
import {
  AUTO_CODE_LENGTH,
  generateShortCode,
  normalizeShortCode,
  SHORT_CODE_ALPHABET,
  vanityProblem,
} from '../src/domain/short-code.ts';

describe('short codes (M1.4d)', () => {
  it('generates codes from the unambiguous alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = generateShortCode();
      expect(c).toHaveLength(AUTO_CODE_LENGTH);
      for (const ch of c) expect(SHORT_CODE_ALPHABET).toContain(ch);
      expect(c).not.toMatch(/[01ilo]/);
      seen.add(c);
    }
    expect(seen.size).toBe(500);
  });

  it('auto codes satisfy the database format', () => {
    for (let i = 0; i < 100; i++)
      expect(generateShortCode()).toMatch(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/);
  });

  it('validates vanity codes', () => {
    expect(vanityProblem('Summer-Gala-2027')).toBeNull();
    expect(normalizeShortCode('  Summer-Gala ')).toBe('summer-gala');
    expect(vanityProblem('ab')).toBe('too_short');
    expect(vanityProblem('a'.repeat(41))).toBe('too_long');
    expect(vanityProblem('-gala')).toBe('invalid_characters');
    expect(vanityProblem('gala-')).toBe('invalid_characters');
    expect(vanityProblem('ga--la')).toBe('invalid_characters');
    expect(vanityProblem('gala night')).toBe('invalid_characters');
    expect(vanityProblem('gala/../x')).toBe('invalid_characters');
    expect(vanityProblem('café')).toBe('invalid_characters');
    expect(vanityProblem('Admin')).toBe('reserved');
    expect(vanityProblem('events')).toBe('reserved');
  });
});
