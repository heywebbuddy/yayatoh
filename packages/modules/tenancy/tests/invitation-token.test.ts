import { describe, expect, it } from 'vitest';
import { signInvitation, verifyInvitationToken } from '../src/domain/invitation-token.ts';

const SECRET = 'x'.repeat(40);
const ID = '0190f5f6-0000-7000-8000-000000000123';

describe('invitation tokens', () => {
  it('round-trips and rejects tampering or another secret', () => {
    const t = signInvitation(ID, SECRET);
    expect(verifyInvitationToken(t, SECRET)).toBe(ID);
    expect(verifyInvitationToken(t.replace(ID, '0190f5f6-0000-7000-8000-000000000124'), SECRET)).toBeNull();
    expect(verifyInvitationToken(t, 'y'.repeat(40))).toBeNull();
    expect(verifyInvitationToken('garbage', SECRET)).toBeNull();
  });
});
