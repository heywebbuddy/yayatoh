import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateKeyPair,
  randomShortCode,
  signTicketCode,
  verifyTicketCode,
} from '../src/index.ts';

const TICKET = '0190f5f6-1234-7abc-8def-0123456789ab';

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (let n = 0; n < 40; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
      expect(base32Decode(base32Encode(b))).toEqual(b);
    }
    expect(base32Decode('not base32!')).toBeNull();
  });
});

describe('yy1 ticket codes', () => {
  it('verifies with only the public key and fits a V7-M QR (178 alphanumeric chars)', async () => {
    const k = await generateKeyPair();
    const code = await signTicketCode({ kid: 7, ticketId: TICKET, rev: 3 }, k.privateKey);
    expect(code).toMatch(/^YY1[A-Z2-7]+$/);
    expect(code.length).toBe(139);
    expect(await verifyTicketCode(code, new Map([[7, k.publicKey]]))).toEqual({
      ok: true,
      kid: 7,
      ticketId: TICKET,
      rev: 3,
    });
  });

  it('rejects tampering, unknown keys, another org’s key and garbage', async () => {
    const k = await generateKeyPair();
    const other = await generateKeyPair();
    const code = await signTicketCode({ kid: 1, ticketId: TICKET, rev: 0 }, k.privateKey);
    const flipped = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11);
    expect(await verifyTicketCode(flipped, new Map([[1, k.publicKey]]))).toMatchObject({ ok: false });
    expect(await verifyTicketCode(code, new Map([[2, k.publicKey]]))).toEqual({
      ok: false,
      reason: 'unknown_key',
    });
    expect(await verifyTicketCode(code, new Map([[1, other.publicKey]]))).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(await verifyTicketCode('hello', new Map())).toEqual({ ok: false, reason: 'malformed' });
  });

  it('short codes are 8 unambiguous characters', () => {
    expect(randomShortCode()).toMatch(/^[2-9A-HJKMNP-TV-Z]{8}$/);
  });
});
