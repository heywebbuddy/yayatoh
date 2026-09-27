import { describe, expect, it } from 'vitest';
import { signLinkToken, verifyLinkToken } from '../src/tokens.ts';

const S = 'x'.repeat(40);
const ID = '01931f6e-7c2a-7000-8000-000000000001';

describe('link tokens', () => {
  it('round-trips and binds the purpose', () => {
    const t = signLinkToken('claim', ID, S);
    expect(verifyLinkToken('claim', t, S)).toBe(ID);
    expect(verifyLinkToken('holder', t, S)).toBeNull();
    expect(verifyLinkToken('claim', t, 'y'.repeat(40))).toBeNull();
  });

  it('rejects tampering and junk', () => {
    const t = signLinkToken('claim', ID, S);
    expect(verifyLinkToken('claim', `${t.slice(0, -1)}${t.at(-1) === 'A' ? 'B' : 'A'}`, S)).toBeNull();
    expect(verifyLinkToken('claim', t.replace(ID, ID.replace('1', '2')), S)).toBeNull();
    expect(verifyLinkToken('claim', 'nope', S)).toBeNull();
    expect(verifyLinkToken('claim', `not-a-uuid~${t.split('~')[1]}`, S)).toBeNull();
  });
});
