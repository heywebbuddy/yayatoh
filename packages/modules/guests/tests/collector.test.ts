import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INVITE_COPY,
  defaultInviteCopy,
  fillInvite,
  INVITE_LOCALES,
  isE164,
  mergeContact,
  newMembers,
  normalizeEmail,
  normalizePhone,
} from '../src/index.ts';

/** M4.1f: the collector's pure rules and the built-in invitation wording. */
describe('contact collector rules', () => {
  it('normalizes emails and phones; texts only to E.164', () => {
    expect(normalizeEmail('  ana@example.test ')).toBe('ana@example.test');
    for (const bad of ['ana', 'ana@', '@x.y', 'a b@example.test', 'ana@example'])
      expect(normalizeEmail(bad)).toBeNull();
    expect(normalizePhone('+1 (312) 555-0142')).toBe('+13125550142');
    expect(normalizePhone('312.555.0142')).toBe('3125550142');
    for (const bad of ['call me', '123', '+1 2345678901234567', '555-ABC-1234'])
      expect(normalizePhone(bad)).toBeNull();
    expect(isE164('+13125550142')).toBe(true);
    expect(isE164('3125550142')).toBe(false);
    expect(isE164('+0123456789')).toBe(false);
    expect(isE164(null)).toBe(false);
  });

  it('merges field by field: use takes a submitted value, keep or nothing submitted leaves the party’s', () => {
    const current = { address: '1 Old Rd', email: 'old@example.test', phone: null };
    const submitted = { address: '9 New St', email: 'new@example.test', phone: null };
    expect(mergeContact(current, submitted, { address: 'use', email: 'keep', phone: 'use' })).toEqual({
      values: { address: '9 New St', email: 'old@example.test', phone: null },
      changed: ['address'],
    });
    // A missing choice keeps; the same value is no change.
    expect(mergeContact(current, { ...current }, { address: 'use' }).changed).toEqual([]);
    expect(mergeContact(current, submitted, {}).changed).toEqual([]);
  });

  it('offers only the people the party does not have (case and spacing aside)', () => {
    const party = [
      { firstName: 'Luis', lastName: 'López' },
      { firstName: 'Ana', lastName: null },
    ];
    expect(
      newMembers(party, [
        { firstName: ' luis ', lastName: 'LÓPEZ' },
        { firstName: 'Ana', lastName: null },
        { firstName: 'Ana', lastName: 'García' },
        { firstName: 'Sofía', lastName: null },
      ]),
    ).toEqual([2, 3]);
  });
});

describe('invitation wording', () => {
  it('has built-in wording in all 13 languages with the placeholders', () => {
    expect(INVITE_LOCALES).toHaveLength(13);
    for (const l of INVITE_LOCALES) {
      const c = DEFAULT_INVITE_COPY[l];
      expect(c.subject).toContain('{event}');
      expect(c.message).toContain('{party}');
      expect(c.smsText).toContain('{party}');
      expect(c.subject.length).toBeLessThanOrEqual(150);
      expect(c.smsText.length).toBeLessThanOrEqual(320);
    }
    expect(defaultInviteCopy('xx')).toBe(DEFAULT_INVITE_COPY.en);
  });

  it('fills {party} and {event} only', () => {
    expect(fillInvite('Dear {party}, {event} {when}', { party: 'The Chens', event: 'Our wedding' })).toBe(
      'Dear The Chens, Our wedding {when}',
    );
    // A name with braces is inserted as written, never re-filled.
    expect(fillInvite('{party}/{event}', { party: '{event}', event: 'E' })).toBe('{event}/E');
  });
});
