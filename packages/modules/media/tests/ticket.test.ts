import { describe, expect, it } from 'vitest';
import { signUploadTicket, UPLOAD_TICKET_TTL_SECONDS, verifyUploadTicket } from '../src/ticket.ts';

const SECRET = 'x'.repeat(40);
const T = {
  orgId: '0190f2a4-1c2b-7cde-8f00-000000000001',
  ownerType: 'event' as const,
  ownerId: '0190f2a4-1c2b-7cde-8f00-000000000002',
  slot: 'cover' as const,
  userId: 'user-1',
};
const now = new Date('2026-09-28T12:00:00Z');

describe('upload tickets', () => {
  it('round-trips and expires after the TTL', () => {
    const token = signUploadTicket(T, now, SECRET);
    expect(verifyUploadTicket(token, now, SECRET)).toMatchObject(T);
    const later = new Date(now.getTime() + (UPLOAD_TICKET_TTL_SECONDS + 1) * 1000);
    expect(verifyUploadTicket(token, later, SECRET)).toBeNull();
  });

  it('refuses tampering, another secret and garbage', () => {
    const token = signUploadTicket(T, now, SECRET);
    const [payload, mac] = token.split('.') as [string, string];
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
        orgId: '0190f2a4-1c2b-7cde-8f00-000000000009',
      }),
    ).toString('base64url');
    expect(verifyUploadTicket(`${forged}.${mac}`, now, SECRET)).toBeNull();
    expect(verifyUploadTicket(token, now, 'y'.repeat(40))).toBeNull();
    for (const bad of ['', '.', 'abc', `${payload}.`, `.${mac}`])
      expect(verifyUploadTicket(bad, now, SECRET)).toBeNull();
  });
});
