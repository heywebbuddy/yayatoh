import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addressHash, normalizeAddress } from '../src/erased-addresses.ts';

describe('erased-address keys (M1.14e)', () => {
  it('normalizes: trims, lower-cases and composes Unicode (NFC)', () => {
    expect(normalizeAddress('  Ada.Lovelace@Example.TEST ')).toBe('ada.lovelace@example.test');
    // "é" as e + combining acute (NFD) and as one code point (NFC) are the same address.
    expect(normalizeAddress('René@example.test')).toBe('rené@example.test');
    // Plus tags and dots are kept: they can be different mailboxes.
    expect(normalizeAddress('a.b+tag@example.test')).toBe('a.b+tag@example.test');
  });

  it('hashes the normalized address with SHA-256 (hex), never keeping the address', () => {
    const h = addressHash(' ADA@example.test');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(createHash('sha256').update('ada@example.test').digest('hex'));
    expect(addressHash('ada@example.test')).toBe(h);
    expect(addressHash('ada+x@example.test')).not.toBe(h);
    expect(h).not.toContain('ada');
  });
});
