import { describe, expect, it } from 'vitest';
import {
  allowanceUse,
  boothWarnings,
  DEFAULT_STAFF_ALLOWANCE,
  holdsPlace,
  memberExpiry,
  nextPrimary,
  planAssignment,
  staffAllowance,
} from '../src/domain/exhibitors.ts';
import {
  newPortalSecret,
  parsePortalLinkToken,
  parsePortalSessionToken,
  portalLinkToken,
  portalSecretHash,
  portalSessionToken,
  portalSiteToken,
  sameHash,
  verifyPortalSiteToken,
} from '../src/domain/portal-token.ts';

const ORG = '0190a8a0-0000-7000-8000-000000000001';
const OTHER = '0190a8a0-0000-7000-8000-000000000002';
const MEMBER = '0190a8a0-0000-7000-8000-00000000000a';
const APP = 'x'.repeat(64);

describe('staff allowance (M5.4a)', () => {
  it('the exhibitor’s own allowance wins, then the event’s, then the default', () => {
    expect(staffAllowance(3, 7)).toBe(7);
    expect(staffAllowance(3, null)).toBe(3);
    expect(staffAllowance(null, null)).toBe(DEFAULT_STAFF_ALLOWANCE);
    expect(staffAllowance(3, 0)).toBe(0);
  });

  it('pending and active staff hold a place; revoked staff and admins don’t', () => {
    expect(holdsPlace({ role: 'exhibitor_staff', status: 'pending' })).toBe(true);
    expect(holdsPlace({ role: 'exhibitor_staff', status: 'active' })).toBe(true);
    expect(holdsPlace({ role: 'exhibitor_staff', status: 'revoked' })).toBe(false);
    expect(holdsPlace({ role: 'exhibitor_admin', status: 'active' })).toBe(false);
    const members = [
      { role: 'exhibitor_admin', status: 'active' },
      { role: 'exhibitor_staff', status: 'pending' },
      { role: 'exhibitor_staff', status: 'active' },
      { role: 'exhibitor_staff', status: 'revoked' },
    ];
    expect(allowanceUse(3, members)).toEqual({ allowance: 3, used: 2, left: 1 });
    // A lowered allowance never shows a negative number of places.
    expect(allowanceUse(1, members)).toEqual({ allowance: 1, used: 2, left: 0 });
  });

  it('access ends 90 days after the event', () => {
    expect(memberExpiry(new Date('2030-05-02T23:00:00Z')).toISOString()).toBe('2030-07-31T23:00:00.000Z');
  });
});

describe('booth assignment rules', () => {
  it('the first exhibitor is primary; later ones are co-exhibitors', () => {
    expect(planAssignment([], 'a', false)).toEqual({
      kind: 'assign',
      primary: true,
      demote: null,
      existing: false,
    });
    expect(planAssignment([{ exhibitorId: 'a', isPrimary: true }], 'b', false)).toEqual({
      kind: 'assign',
      primary: false,
      demote: null,
      existing: false,
    });
  });

  it('asking for primary moves it and demotes the old primary; repeats change nothing', () => {
    const seats = [
      { exhibitorId: 'a', isPrimary: true },
      { exhibitorId: 'b', isPrimary: false },
    ];
    expect(planAssignment(seats, 'b', true)).toEqual({
      kind: 'assign',
      primary: true,
      demote: 'a',
      existing: true,
    });
    expect(planAssignment(seats, 'c', true)).toEqual({
      kind: 'assign',
      primary: true,
      demote: 'a',
      existing: false,
    });
    expect(planAssignment(seats, 'a', true)).toEqual({ kind: 'already', exhibitorId: 'a' });
    expect(planAssignment(seats, 'b', false)).toEqual({ kind: 'already', exhibitorId: 'b' });
    expect(planAssignment(seats, 'a', false)).toEqual({ kind: 'already', exhibitorId: 'a' });
  });

  it('when the primary leaves, the longest-standing co-exhibitor takes over', () => {
    const rest = [
      { exhibitorId: 'late', isPrimary: false, createdAt: new Date(2000) },
      { exhibitorId: 'early', isPrimary: false, createdAt: new Date(1000) },
    ];
    expect(nextPrimary(rest, true)).toBe('early');
    expect(nextPrimary(rest, false)).toBeNull();
    expect(nextPrimary([], true)).toBeNull();
  });

  it('warns on overlaps, shared booths, several booths and category mismatches', () => {
    const booths = [
      { id: 'b1', number: 'A1', category: 'Food', x: 0, y: 0, width: 300, height: 300 },
      { id: 'b2', number: 'A2', category: null, x: 300, y: 0, width: 300, height: 300 },
      { id: 'b3', number: 'A10', category: null, x: 500, y: 100, width: 300, height: 300 },
    ];
    const assignments = [
      { boothId: 'b1', exhibitorId: 'x' },
      { boothId: 'b1', exhibitorId: 'y' },
      { boothId: 'b2', exhibitorId: 'x' },
    ];
    const cats = new Map([
      ['x', ['food']],
      ['y', ['Software']],
    ]);
    expect(boothWarnings(booths, assignments, cats)).toEqual([
      // Touching edges (A1|A2) don't overlap; A2 and A10 do.
      { kind: 'booths_overlap', boothId: 'b2', otherBoothId: 'b3', exhibitorId: null },
      { kind: 'shared_booth', boothId: 'b1', otherBoothId: null, exhibitorId: null },
      { kind: 'category_mismatch', boothId: 'b1', otherBoothId: null, exhibitorId: 'y' },
      { kind: 'several_booths', boothId: null, otherBoothId: null, exhibitorId: 'x' },
    ]);
    // Exhibitors without categories never mismatch.
    expect(
      boothWarnings([booths[0] as (typeof booths)[0]], [{ boothId: 'b1', exhibitorId: 'z' }], new Map()),
    ).toEqual([]);
  });
});

describe('portal links, sessions and site tokens', () => {
  it('links and sessions round-trip; anything else is refused', () => {
    const secret = newPortalSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parsePortalLinkToken(portalLinkToken(ORG, MEMBER, secret))).toEqual({
      orgId: ORG,
      memberId: MEMBER,
      secret,
    });
    expect(parsePortalSessionToken(portalSessionToken(ORG, secret))).toEqual({ orgId: ORG, secret });
    for (const bad of [
      '',
      `${ORG}.${secret}`,
      `${ORG}.${MEMBER}.short`,
      `${ORG}.${MEMBER}.${secret}x`,
      `X${ORG}.${MEMBER}.${secret}`,
    ])
      expect(parsePortalLinkToken(bad)).toBeNull();
    expect(parsePortalSessionToken(`${ORG}.${MEMBER}`)).toBeNull();
  });

  it('hashes differ by purpose and compare in constant time', () => {
    const s = newPortalSecret();
    const link = portalSecretHash(APP, 'link', s);
    expect(link).toMatch(/^[0-9a-f]{64}$/);
    expect(portalSecretHash(APP, 'session', s)).not.toBe(link);
    expect(sameHash(link, portalSecretHash(APP, 'link', s))).toBe(true);
    expect(sameHash(link, portalSecretHash(APP, 'link', newPortalSecret()))).toBe(false);
    expect(sameHash(null, link)).toBe(false);
    expect(sameHash('', '')).toBe(false);
  });

  it('a site token is signed: another org or event, or another secret, fails', () => {
    const t = portalSiteToken(APP, ORG, MEMBER);
    expect(verifyPortalSiteToken(APP, t)).toEqual({ orgId: ORG, eventId: MEMBER });
    expect(verifyPortalSiteToken(APP, t.replace(ORG, OTHER))).toBeNull();
    expect(verifyPortalSiteToken('y'.repeat(64), t)).toBeNull();
    expect(verifyPortalSiteToken(APP, 'nonsense')).toBeNull();
  });
});
