import { describe, expect, it } from 'vitest';
import {
  canonicalEmail,
  defaultChoices,
  defaultSurvivor,
  mergedFields,
  scoreDuplicate,
  strictestConsent,
} from '../src/merge/domain.ts';

const rec = (over: Partial<Parameters<typeof mergedFields>[0]> = {}) => ({
  email: 'a@example.test',
  name: 'Ada Lovelace',
  phoneE164: null,
  company: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

describe('canonicalEmail', () => {
  it('drops +tags and case', () => {
    expect(canonicalEmail(' Jane.Doe+VIP@Example.test ')).toBe('jane.doe@example.test');
  });
  it('drops dots for Gmail and folds googlemail', () => {
    expect(canonicalEmail('j.o.h.n+x@googlemail.com')).toBe('john@gmail.com');
    expect(canonicalEmail('john@gmail.com')).toBe('john@gmail.com');
  });
  it('keeps dots elsewhere and leaves odd input alone', () => {
    expect(canonicalEmail('j.ohn@example.test')).toBe('j.ohn@example.test');
    expect(canonicalEmail('+x@example.test')).toBe('+x@example.test');
    expect(canonicalEmail('nope')).toBe('nope');
  });
});

describe('scoreDuplicate', () => {
  const none = { sameEmail: false, samePhone: false, nameSimilarity: null, companySimilarity: null };
  it('no reason, no candidate', () => {
    expect(scoreDuplicate(none)).toBeNull();
    // A similar name alone (no company) is not enough.
    expect(scoreDuplicate({ ...none, nameSimilarity: 0.95 })).toBeNull();
    // Below either threshold.
    expect(scoreDuplicate({ ...none, nameSimilarity: 0.59, companySimilarity: 1 })).toBeNull();
    expect(scoreDuplicate({ ...none, nameSimilarity: 1, companySimilarity: 0.5 })).toBeNull();
  });
  it('scores each reason and combines them', () => {
    expect(scoreDuplicate({ ...none, sameEmail: true })).toEqual({ score: 90, reasons: ['email'] });
    expect(scoreDuplicate({ ...none, samePhone: true })).toEqual({ score: 80, reasons: ['phone'] });
    expect(scoreDuplicate({ ...none, nameSimilarity: 1, companySimilarity: 1 })).toEqual({
      score: 85,
      reasons: ['name_company'],
    });
    expect(scoreDuplicate({ ...none, nameSimilarity: 0.6, companySimilarity: 0.6 })).toEqual({
      score: 65,
      reasons: ['name_company'],
    });
    // 1 − 0.1 × 0.2 = 0.98
    expect(scoreDuplicate({ ...none, sameEmail: true, samePhone: true })).toEqual({
      score: 98,
      reasons: ['email', 'phone'],
    });
    // Never 100.
    expect(
      scoreDuplicate({ sameEmail: true, samePhone: true, nameSimilarity: 1, companySimilarity: 1 })?.score,
    ).toBe(99);
  });
});

describe('merge choices', () => {
  it('keeps the older record by default', () => {
    const old = rec({ createdAt: new Date('2025-01-01T00:00:00Z') });
    const young = rec();
    expect(defaultSurvivor(young, old).keep).toBe(old);
    expect(defaultSurvivor(old, young).keep).toBe(old);
  });
  it('defaults each field to the most recent non-empty value', () => {
    const target = rec({ name: 'Ada L.', phoneE164: '+15550100001', company: null });
    const source = rec({
      email: 'ada@example.test',
      name: 'Ada Lovelace',
      phoneE164: null,
      company: 'Analytical Engines',
      updatedAt: new Date('2026-02-01T00:00:00Z'),
    });
    const choices = defaultChoices(source, target);
    expect(choices).toEqual({ name: 'source', email: 'source', phone: 'target', company: 'source' });
    expect(mergedFields(source, target, choices)).toEqual({
      email: 'ada@example.test',
      name: 'Ada Lovelace',
      phoneE164: '+15550100001',
      company: 'Analytical Engines',
    });
    // The target is more recent: its values win where present.
    const later = { ...target, updatedAt: new Date('2026-03-01T00:00:00Z') };
    expect(defaultChoices(source, later)).toEqual({
      name: 'target',
      email: 'target',
      phone: 'target',
      company: 'source',
    });
    // Both empty: the target's.
    expect(defaultChoices(rec({ name: null }), rec({ name: '  ' })).name).toBe('target');
  });
});

describe('strictestConsent', () => {
  it('an opt-out wins', () => {
    expect(strictestConsent('granted', 'withdrawn')).toEqual({ status: 'withdrawn', from: 'source' });
    expect(strictestConsent('withdrawn', 'granted')).toEqual({ status: 'withdrawn', from: 'target' });
    expect(strictestConsent(null, 'withdrawn')).toEqual({ status: 'withdrawn', from: 'source' });
  });
  it('otherwise a grant beats a legacy unknown, which beats none', () => {
    expect(strictestConsent('unknown_legacy', 'granted')).toEqual({ status: 'granted', from: 'source' });
    expect(strictestConsent(null, 'unknown_legacy')).toEqual({ status: 'unknown_legacy', from: 'source' });
    expect(strictestConsent('granted', null)).toEqual({ status: 'granted', from: 'target' });
    expect(strictestConsent('granted', 'granted')).toEqual({ status: 'granted', from: 'target' });
    expect(strictestConsent(null, null)).toEqual({ status: null, from: null });
  });
});
