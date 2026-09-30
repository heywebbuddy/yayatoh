import { describe, expect, it } from 'vitest';
import { accountSummary, buildAccountDocument } from '../src/account.ts';

const at = new Date('2026-09-01T10:00:00Z');

/** Module rows as they come back, with fields that must never leave. */
const parts = {
  email: 'ada@example.test',
  now: at,
  identity: {
    profile: {
      name: 'Ada',
      email: 'ada@example.test',
      emailVerified: true,
      emailLanguage: 'fr',
      createdAt: at,
      passwordHash: '$argon2id$v=19$secret',
    },
    signIn: {
      password: true,
      emailCodes: true,
      twoStepVerification: true,
      providers: ['credential'],
      totpSecret: 'JBSWY3DP',
    },
    sessions: [
      {
        current: true,
        signedInAt: at,
        lastActiveAt: at,
        expiresAt: at,
        ipAddress: '203.0.113.9',
        device: 'Firefox',
        token: 'session-token-must-not-leave',
      },
    ],
    securityEvents: [
      { action: 'step_up.confirmed', details: { method: 'totp' }, at, data: { code: '123456' } },
    ],
    backupCodes: ['aaaa-bbbb'],
  },
  orgs: [
    {
      name: 'Bravo Weddings',
      membership: null,
      preferences: [],
      agreements: [],
      orders: [
        {
          id: '0190',
          eventId: 'e1',
          status: 'paid',
          buyerName: 'Ada',
          buyerEmail: 'ada@example.test',
          currency: 'USD',
          totalMinor: 2500,
          promoCode: null,
          paymentMethod: null,
          createdAt: at,
          paidAt: at,
          items: [{ name: 'GA', quantity: 1, unitFaceMinor: 2500, costMinor: 1 }],
          refunds: [],
          manageTokenCiphertext: 'local.v1.x',
          providerPaymentId: 'pi_123',
          buyerUserId: 'u1',
        },
      ],
      tickets: [
        {
          id: 't1',
          eventId: 'e1',
          orderId: '0190',
          shortCode: 'ABC123',
          status: 'active',
          holderName: 'Ada',
          holderEmail: 'ada@example.test',
          seatLabel: null,
          createdAt: at,
          signature: 'sig',
        },
      ],
      consents: [
        {
          channel: 'email',
          purpose: 'marketing',
          status: 'granted',
          evidence: 'checkout',
          capturedAt: at,
          contactId: 'c1',
        },
      ],
      invitations: [],
      events: { e1: 'Garden Party' },
    },
    {
      name: 'Alpha Events',
      membership: { role: 'manager', since: at },
      preferences: [{ category: 'sales', channel: 'email', enabled: true, userId: 'u1' }],
      agreements: [{ document: 'platform_tos', version: '2026-01', acceptedAt: at, acceptedBy: 'u1' }],
      orders: [],
      tickets: [],
      consents: [],
      invitations: [
        {
          email: 'ada@example.test',
          role: 'viewer',
          status: 'pending',
          invitedAt: at,
          expiresAt: at,
          invitedBy: 'owner-id',
        },
      ],
      events: {} as Record<string, string>,
    },
  ],
};

describe('account access document (M1.14e)', () => {
  it('keeps only allowlisted fields: no tokens, hashes, secrets, provider ids or other people', () => {
    const doc = buildAccountDocument(parts);
    const text = JSON.stringify(doc);
    for (const secret of [
      'session-token-must-not-leave',
      'argon2',
      'JBSWY3DP',
      'aaaa-bbbb',
      '123456',
      'pi_123',
      'local.v1.x',
      'owner-id',
      'contactId',
      'signature',
      'costMinor',
      'buyerUserId',
    ])
      expect(text).not.toContain(secret);
    expect(doc.format).toBe('yayatoh.account/1');
    expect(doc.account?.sessions[0]).toEqual({
      current: true,
      signedInAt: at,
      lastActiveAt: at,
      expiresAt: at,
      ipAddress: '203.0.113.9',
      device: 'Firefox',
    });
  });

  it('groups memberships, purchases and invitations by organization', () => {
    const doc = buildAccountDocument(parts);
    expect(doc.organizations).toEqual([
      {
        organization: 'Alpha Events',
        role: 'manager',
        memberSince: at,
        notificationPreferences: [{ category: 'sales', channel: 'email', enabled: true }],
        agreements: [{ document: 'platform_tos', version: '2026-01', acceptedAt: at }],
      },
    ]);
    expect(doc.purchases.map((p) => p.organizer)).toEqual(['Bravo Weddings']);
    expect(doc.purchases[0]?.orders[0]?.items).toEqual([{ name: 'GA', quantity: 1, unitFaceMinor: 2500 }]);
    expect(doc.teamInvitations).toEqual([
      { organization: 'Alpha Events', role: 'viewer', status: 'pending', invitedAt: at, expiresAt: at },
    ]);
    expect(accountSummary(doc)).toEqual({
      account: 1,
      sessions: 1,
      securityEvents: 1,
      memberships: 1,
      orders: 1,
      tickets: 1,
      consents: 1,
      invitations: 1,
    });
  });

  it('works for an address without an account (staff requests)', () => {
    const doc = buildAccountDocument({ ...parts, identity: null, orgs: [] });
    expect(doc.account).toBeNull();
    expect(accountSummary(doc).account).toBe(0);
  });
});
