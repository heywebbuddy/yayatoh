import { describe, expect, it } from 'vitest';
import {
  checkPortalAccount,
  checkPortalCode,
  checkPortalLink,
  maskPortalEmail,
  PORTAL_CODE_TTL_MS,
  PORTAL_GRACE_MS,
  PORTAL_SESSION_MS,
  parsePortalLinkToken,
  parsePortalSessionToken,
  portalCodeHash,
  portalExpiresAt,
  portalLinkToken,
  portalResendAt,
  portalSecretHash,
  portalSessionExpiry,
  signPortalInvite,
  verifyPortalInvite,
} from '../src/domain/portal-auth.ts';

const SECRET = 'x'.repeat(64);
const ORG = '01900000-0000-7000-8000-000000000001';
const ACCOUNT = '01900000-0000-7000-8000-000000000002';
const now = new Date('2027-05-01T12:00:00Z');

describe('portal invitations (M5.3a, P5-7)', () => {
  it('are signed: org, account and version come back only from an authentic token', () => {
    const t = signPortalInvite(SECRET, { orgId: ORG, accountId: ACCOUNT, version: 3 });
    expect(verifyPortalInvite(SECRET, t)).toEqual({ orgId: ORG, accountId: ACCOUNT, version: 3 });
    expect(verifyPortalInvite('y'.repeat(64), t)).toBeNull();
    // Swapping the org (or anything else) breaks the signature.
    const other = '01900000-0000-7000-8000-00000000000f';
    expect(verifyPortalInvite(SECRET, t.replace(ORG, other))).toBeNull();
    expect(verifyPortalInvite(SECRET, t.replace('~3~', '~4~'))).toBeNull();
    expect(verifyPortalInvite(SECRET, `${t}x`)).toBeNull();
    expect(verifyPortalInvite(SECRET, 'nonsense')).toBeNull();
    // No dots: the locale proxy treats dotted paths as files.
    expect(t).not.toContain('.');
  });

  it('expire with the event plus 90 days, and can be revoked or reissued', () => {
    const ends = new Date('2027-05-02T00:00:00Z');
    const expiresAt = portalExpiresAt(ends);
    expect(expiresAt.getTime() - ends.getTime()).toBe(PORTAL_GRACE_MS);
    const row = { inviteVersion: 2, revokedAt: null, expiresAt };
    expect(checkPortalAccount(row, now)).toBe('ok');
    expect(checkPortalAccount(row, now, 2)).toBe('ok');
    expect(checkPortalAccount(row, now, 1)).toBe('reissued');
    expect(checkPortalAccount(row, new Date(expiresAt.getTime() - 1))).toBe('ok');
    expect(checkPortalAccount(row, expiresAt)).toBe('expired');
    expect(checkPortalAccount({ ...row, revokedAt: now }, now, 2)).toBe('revoked');
  });
});

describe('portal codes and magic links (M1.5f rules)', () => {
  const id = '01900000-0000-7000-8000-0000000000aa';
  const row = (over: Partial<Parameters<typeof checkPortalCode>[1]> = {}) => ({
    id,
    codeHash: portalCodeHash(SECRET, id, '123456'),
    attempts: 0,
    expiresAt: new Date(now.getTime() + PORTAL_CODE_TTL_MS),
    usedAt: null,
    ...over,
  });

  it('accepts the right code once, counts wrong ones and locks at five', () => {
    expect(checkPortalCode(SECRET, row(), '123456', now)).toEqual({ status: 'ok' });
    expect(checkPortalCode(SECRET, row(), '654321', now)).toEqual({ status: 'wrong', attemptsLeft: 4 });
    expect(checkPortalCode(SECRET, row({ attempts: 4 }), '000000', now)).toEqual({ status: 'locked' });
    expect(checkPortalCode(SECRET, row({ attempts: 5 }), '123456', now)).toEqual({ status: 'locked' });
    expect(checkPortalCode(SECRET, row({ usedAt: now }), '123456', now)).toEqual({ status: 'used' });
    expect(checkPortalCode(SECRET, row(), '12345x', now)).toMatchObject({ status: 'wrong' });
    // A code of another challenge never matches.
    expect(
      checkPortalCode(SECRET, row({ codeHash: portalCodeHash(SECRET, 'other', '123456') }), '123456', now),
    ).toMatchObject({ status: 'wrong' });
  });

  it('expires to the millisecond', () => {
    const r = row();
    expect(checkPortalCode(SECRET, r, '123456', new Date(r.expiresAt.getTime() - 1)).status).toBe('ok');
    expect(checkPortalCode(SECRET, r, '123456', r.expiresAt).status).toBe('expired');
  });

  it('refuses a new code within 30 seconds', () => {
    expect(portalResendAt(null, now)).toBeNull();
    expect(portalResendAt(new Date(now.getTime() - 10_000), now)?.getTime()).toBe(now.getTime() + 20_000);
    expect(portalResendAt(new Date(now.getTime() - 30_000), now)).toBeNull();
  });

  it('opens a magic link only in the browser that asked, once, before it expires', () => {
    const link = { linkSecret: 'L'.repeat(43), browser: 'B'.repeat(43) };
    const state = {
      linkHash: portalSecretHash(SECRET, 'link', link.linkSecret),
      browserHash: portalSecretHash(SECRET, 'browser', link.browser),
      linkExpiresAt: new Date(now.getTime() + 60_000),
      usedAt: null,
      attempts: 0,
    };
    expect(checkPortalLink(SECRET, state, link.linkSecret, link.browser, now)).toBe('ok');
    expect(checkPortalLink(SECRET, state, link.linkSecret, 'C'.repeat(43), now)).toBe('other_browser');
    expect(checkPortalLink(SECRET, state, link.linkSecret, null, now)).toBe('other_browser');
    expect(checkPortalLink(SECRET, state, 'M'.repeat(43), link.browser, now)).toBe('invalid');
    expect(checkPortalLink(SECRET, { ...state, usedAt: now }, link.linkSecret, link.browser, now)).toBe(
      'invalid',
    );
    expect(checkPortalLink(SECRET, state, link.linkSecret, link.browser, state.linkExpiresAt)).toBe(
      'invalid',
    );
    expect(checkPortalLink(SECRET, { ...state, attempts: 5 }, link.linkSecret, link.browser, now)).toBe(
      'invalid',
    );
    const token = portalLinkToken(ORG, id, link.linkSecret);
    expect(parsePortalLinkToken(token)).toEqual({ orgId: ORG, challengeId: id, secret: link.linkSecret });
    expect(parsePortalLinkToken(`${token}x`)).toBeNull();
  });
});

describe('portal sessions', () => {
  it('carry the org in the cookie and end at the earlier of a week and the account expiry', () => {
    expect(parsePortalSessionToken(`${ORG}~${'s'.repeat(43)}`)).toEqual({
      orgId: ORG,
      secret: 's'.repeat(43),
    });
    expect(parsePortalSessionToken(`not-an-org~${'s'.repeat(43)}`)).toBeNull();
    expect(parsePortalSessionToken(null)).toBeNull();
    const far = new Date(now.getTime() + 30 * 86_400_000);
    expect(portalSessionExpiry(now, far).getTime()).toBe(now.getTime() + PORTAL_SESSION_MS);
    const soon = new Date(now.getTime() + 3_600_000);
    expect(portalSessionExpiry(now, soon)).toEqual(soon);
  });

  it('masks addresses on the sign-in page', () => {
    expect(maskPortalEmail('ana.speaker@example.test')).toBe('an•••@example.test');
    expect(maskPortalEmail('a@example.test')).toBe('a•@example.test');
  });
});
