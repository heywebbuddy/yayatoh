import { describe, expect, it } from 'vitest';
import {
  capacityFloor,
  claimDelta,
  countOn,
  offerRoom,
  planTypeOffers,
  publicRoom,
} from '../src/domain/capacity.ts';
import {
  domainAllowed,
  eligibilityRefusal,
  emailDomain,
  normalizeAccessCode,
  normalizeDomain,
} from '../src/domain/eligibility.ts';
import {
  DEFAULT_ITEM_KEYS,
  DEFAULT_NAMES,
  DEFAULT_TYPE_KEYS,
  keyFromName,
  priceRange,
  selectionProblem,
  uniqueKey,
} from '../src/domain/matrix.ts';

describe('eligibility: access codes', () => {
  const rule = { kind: 'access_code', accessCode: 'VIP-2027' } as const;
  it('normalizes codes and rejects malformed ones', () => {
    expect(normalizeAccessCode('  vip-2027 ')).toBe('VIP-2027');
    expect(normalizeAccessCode('ab')).toBeNull();
    expect(normalizeAccessCode('has space')).toBeNull();
    expect(normalizeAccessCode('x'.repeat(33))).toBeNull();
  });
  it('asks for a code, refuses a wrong one, accepts the right one in any case', () => {
    expect(eligibilityRefusal(rule, { email: 'a@b.org' })).toBe('code_required');
    expect(eligibilityRefusal(rule, { email: 'a@b.org', accessCode: '   ' })).toBe('code_required');
    expect(eligibilityRefusal(rule, { email: 'a@b.org', accessCode: 'VIP-2028' })).toBe('code_wrong');
    expect(eligibilityRefusal(rule, { email: 'a@b.org', accessCode: 'VIP-202' })).toBe('code_wrong');
    expect(eligibilityRefusal(rule, { email: 'a@b.org', accessCode: 'vip-2027' })).toBeNull();
  });
  it('an open type needs nothing', () => {
    expect(eligibilityRefusal({ kind: 'open' }, { email: '' })).toBeNull();
  });
});

describe('eligibility: email domains', () => {
  const rule = { kind: 'email_domain', emailDomains: ['acme.org', 'uni.edu'] } as const;
  it('normalizes domains', () => {
    expect(normalizeDomain(' @Acme.ORG ')).toBe('acme.org');
    expect(normalizeDomain('.uni.edu.')).toBe('uni.edu');
    expect(normalizeDomain('not a domain')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
  });
  it('reads the domain after the last @', () => {
    expect(emailDomain('Ann@Acme.org')).toBe('acme.org');
    expect(emailDomain('"a@b"@uni.edu')).toBe('uni.edu');
    expect(emailDomain('nobody')).toBeNull();
    expect(emailDomain('@acme.org')).toBeNull();
  });
  it('matches the domain and its subdomains only', () => {
    expect(domainAllowed('acme.org', ['acme.org'])).toBe(true);
    expect(domainAllowed('staff.acme.org', ['acme.org'])).toBe(true);
    expect(domainAllowed('badacme.org', ['acme.org'])).toBe(false);
    expect(domainAllowed('acme.org.evil.com', ['acme.org'])).toBe(false);
  });
  it('refuses other domains and malformed addresses', () => {
    expect(eligibilityRefusal(rule, { email: 'ann@ACME.org' })).toBeNull();
    expect(eligibilityRefusal(rule, { email: 'bo@lab.uni.edu' })).toBeNull();
    expect(eligibilityRefusal(rule, { email: 'cy@gmail.com' })).toBe('domain_not_allowed');
    expect(eligibilityRefusal(rule, { email: 'acme.org' })).toBe('domain_not_allowed');
    // A code is no way around a domain rule.
    expect(eligibilityRefusal(rule, { email: 'cy@gmail.com', accessCode: 'ACME' })).toBe(
      'domain_not_allowed',
    );
  });
});

describe('capacity maths', () => {
  it('keeps back waiting places and open offers from the public', () => {
    expect(publicRoom({ capacity: 10, held: 3, sold: 4 }, { offered: 1, waiting: 1 })).toBe(1);
    expect(publicRoom({ capacity: 10, held: 3, sold: 4 }, { offered: 2, waiting: 5 })).toBe(0);
    expect(publicRoom({ capacity: null, held: 3, sold: 4 }, { offered: 0, waiting: 9 })).toBeNull();
  });
  it('offers only what open offers do not already hold', () => {
    expect(offerRoom({ capacity: 5, held: 2, sold: 1 }, { offered: 1 })).toBe(1);
    expect(offerRoom({ capacity: 5, held: 2, sold: 3 }, { offered: 1 })).toBe(0);
    expect(offerRoom({ capacity: null, held: 0, sold: 0 }, { offered: 0 })).toBeNull();
  });
  it('capacity cannot go below held + sold + offered', () => {
    expect(capacityFloor({ held: 2, sold: 5 }, { offered: 1 })).toBe(8);
  });
  it('a claim moves by its difference only (replays are no-ops)', () => {
    expect(claimDelta({ held: 1, sold: 0 }, { held: 0, sold: 1 })).toEqual({
      held: -1,
      sold: 1,
      changed: true,
    });
    expect(claimDelta({ held: 0, sold: 1 }, { held: 0, sold: 0 })).toEqual({
      held: 0,
      sold: -1,
      changed: true,
    });
    expect(claimDelta({ held: 0, sold: 1 }, { held: 0, sold: 1 }).changed).toBe(false);
    // Applying the same recomputation twice releases once.
    let counter = { held: 1, sold: 0 };
    let claim = { held: 1, sold: 0 };
    for (let i = 0; i < 3; i++) {
      const d = claimDelta(claim, { held: 0, sold: 0 });
      counter = { held: counter.held + d.held, sold: counter.sold + d.sold };
      claim = { held: 0, sold: 0 };
    }
    expect(counter).toEqual({ held: 0, sold: 0 });
  });
  it('counts only the given ticket types', () => {
    const q = new Map([
      ['pass', 1],
      ['dinner', 2],
    ]);
    expect(countOn(q, new Set(['pass']))).toBe(1);
    expect(countOn(q, new Set())).toBe(0);
  });
  it('plans offers in strict line order', () => {
    const line = [
      { id: 'a', quantity: 1 },
      { id: 'b', quantity: 2 },
      { id: 'c', quantity: 1 },
    ];
    expect(planTypeOffers(line, 1).map((e) => e.id)).toEqual(['a']);
    // b does not fit in 2 after a: c must not jump ahead of b.
    expect(planTypeOffers(line, 2).map((e) => e.id)).toEqual(['a']);
    expect(planTypeOffers(line, 4).map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(planTypeOffers(line, 0)).toEqual([]);
  });
});

describe('type × item matrix', () => {
  const offered = new Map([
    ['full', 'admission'],
    ['day', 'admission'],
    ['workshop', 'add_on'],
    ['dinner', 'add_on'],
  ] as const);
  it('needs exactly one admission item', () => {
    expect(selectionProblem(['full'], offered)).toBeNull();
    expect(selectionProblem(['day', 'workshop', 'dinner'], offered)).toBeNull();
    expect(selectionProblem(['workshop'], offered)).toBe('choose_admission');
    expect(selectionProblem(['full', 'day'], offered)).toBe('one_admission');
  });
  it('refuses items not offered to the type and repeats', () => {
    expect(selectionProblem(['full', 'gala'], offered)).toBe('item_unavailable');
    expect(selectionProblem(['full', 'dinner', 'dinner'], offered)).toBe('duplicate_item');
  });
  it('prices a type from its cheapest pass to its dearest pass with every add-on', () => {
    expect(
      priceRange([
        { kind: 'admission', allInMinor: 30000 },
        { kind: 'admission', allInMinor: 12000 },
        { kind: 'add_on', allInMinor: 5000 },
        { kind: 'add_on', allInMinor: 8000 },
      ]),
    ).toEqual({ min: 12000, max: 43000 });
    expect(priceRange([{ kind: 'add_on', allInMinor: 5000 }])).toBeNull();
  });
  it('derives stable, unique keys', () => {
    expect(keyFromName('Non-member')).toBe('non_member');
    expect(keyFromName('Étudiant·e')).toBe('etudiant_e');
    expect(keyFromName('会员')).toBe('type');
    expect(uniqueKey('vip', new Set(['vip', 'vip_2']))).toBe('vip_3');
  });
  it('seeds the six types and four items with names', () => {
    expect(DEFAULT_TYPE_KEYS).toEqual(['member', 'non_member', 'student', 'exhibitor', 'speaker', 'vip']);
    expect(DEFAULT_ITEM_KEYS).toEqual(['full_pass', 'day_pass', 'workshop', 'dinner']);
    for (const k of [...DEFAULT_TYPE_KEYS, ...DEFAULT_ITEM_KEYS]) expect(DEFAULT_NAMES[k]).toBeTruthy();
  });
});
