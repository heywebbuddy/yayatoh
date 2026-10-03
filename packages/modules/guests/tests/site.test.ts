import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BLOCK_CONTENT,
  blockHasContent,
  hashSitePassword,
  moveIndex,
  PASSWORD_HASH_PATTERN,
  verifySitePassword,
} from '../src/domain/site.ts';
import {
  emptyContent,
  GuestSiteDto,
  normalizeSitePassword,
  PublicGuestSiteDto,
  PublicSiteBlockDto,
  passwordProblem,
  programSubEvents,
  readContent,
  SiteBlockDto,
  siteAccessToken,
  siteAccessValid,
} from '../src/index.ts';

const SECRET = 'x'.repeat(64);
const SITE = '0199a000-0000-7000-8000-000000000001';
const sub = (id: string, inviteAll: boolean) => ({ id, inviteAll, name: id });

/** M4.5a: the guest website's pure rules. */
describe('guest website rules', () => {
  it('passwords: 6 to 72 characters; case and surrounding spaces do not matter', () => {
    expect(passwordProblem('abc')).toBe('too_short');
    expect(passwordProblem('   abcde  ')).toBe('too_short');
    expect(passwordProblem('a'.repeat(73))).toBe('too_long');
    expect(passwordProblem('lake house')).toBeNull();
    expect(normalizeSitePassword('  Lake House ')).toBe('lake house');
  });

  it('hashes with scrypt (never the password) and verifies in constant time', async () => {
    const hash = await hashSitePassword('Lake House');
    expect(hash).toMatch(PASSWORD_HASH_PATTERN);
    expect(hash).not.toContain('Lake');
    expect(await verifySitePassword('lake house', hash)).toBe(true);
    expect(await verifySitePassword(' LAKE HOUSE ', hash)).toBe(true);
    expect(await verifySitePassword('lake-house', hash)).toBe(false);
    expect(await verifySitePassword('lake house', null)).toBe(false);
    expect(await verifySitePassword('lake house', 'scrypt$bad')).toBe(false);
    // A second hash of the same password differs (random salt).
    expect(await hashSitePassword('Lake House')).not.toBe(hash);
  });

  it('access proofs are bound to the site and the password version', () => {
    const token = siteAccessToken(SITE, 1, SECRET);
    expect(siteAccessValid(token, SITE, 1, SECRET)).toBe(true);
    expect(siteAccessValid(token, SITE, 2, SECRET)).toBe(false);
    expect(siteAccessValid(token, '0199a000-0000-7000-8000-000000000002', 1, SECRET)).toBe(false);
    expect(siteAccessValid(token, SITE, 1, 'y'.repeat(64))).toBe(false);
    expect(siteAccessValid(`${token}x`, SITE, 1, SECRET)).toBe(false);
    expect(siteAccessValid(null, SITE, 1, SECRET)).toBe(false);
    expect(siteAccessValid('', SITE, 1, SECRET)).toBe(false);
  });

  it('a program shows the sub-events everyone is invited to, or the host’s pick, in order', () => {
    const all = [sub('a', true), sub('b', false), sub('c', true)];
    expect(programSubEvents(all, { show: 'everyone', subEventIds: ['b'] }).map((s) => s.id)).toEqual([
      'a',
      'c',
    ]);
    expect(programSubEvents(all, { show: 'chosen', subEventIds: ['c', 'b', 'zz'] }).map((s) => s.id)).toEqual(
      ['b', 'c'],
    );
    expect(programSubEvents(all, { show: 'chosen', subEventIds: [] })).toEqual([]);
  });

  it('content: links are https only; markdown is sanitized; empty lists start empty', () => {
    expect(emptyContent('faq')).toEqual({ items: [] });
    expect(emptyContent('program')).toEqual({ show: 'everyone', subEventIds: [] });
    const reg = BLOCK_CONTENT.registry;
    expect(reg.safeParse({ items: [{ label: 'Gift list', url: 'https://gifts.example/x' }] }).success).toBe(
      true,
    );
    for (const url of ['http://gifts.example', 'javascript:alert(1)', 'https://u:p@gifts.example', 'gifts'])
      expect(reg.safeParse({ items: [{ label: 'Gift list', url }] }).success).toBe(false);
    const travel = BLOCK_CONTENT.travel.parse({ items: [{ title: 'Hotel', details: 'Hi‮', url: '' }] });
    expect(travel.items[0]).toEqual({ title: 'Hotel', details: 'Hi', url: null });
    expect(BLOCK_CONTENT.faq.safeParse({ items: [{ question: 'Kids?', answer: '  ' }] }).success).toBe(false);
    expect(
      BLOCK_CONTENT.registry.safeParse({ items: Array(21).fill({ label: 'x', url: 'https://a.b' }) }).success,
    ).toBe(false);
  });

  it('stored content is read item by item: anything malformed or unknown is dropped', () => {
    expect(
      readContent('faq', {
        items: [{ question: 'Parking?', answer: 'Yes.' }, '__CANARY_x__', { question: 'No answer' }],
        __canary: 'x',
      }),
    ).toEqual({ kind: 'faq', content: { items: [{ question: 'Parking?', answer: 'Yes.' }] } });
    expect(readContent('text', 'nope')).toEqual({ kind: 'text', content: { body: '' } });
    expect(readContent('program', { show: 'chosen', subEventIds: ['not-a-uuid'] })).toEqual({
      kind: 'program',
      content: { show: 'everyone', subEventIds: [] },
    });
    expect(blockHasContent(readContent('registry', { items: [] }))).toBe(false);
    expect(blockHasContent(readContent('text', { body: ' ' }))).toBe(false);
    expect(blockHasContent(readContent('program', {}), 0)).toBe(false);
    expect(blockHasContent(readContent('program', {}), 2)).toBe(true);
  });

  it('blocks move one step at a time', () => {
    expect(moveIndex(3, 0, 'up')).toBeNull();
    expect(moveIndex(3, 0, 'down')).toBe(1);
    expect(moveIndex(3, 2, 'down')).toBeNull();
    expect(moveIndex(3, 2, 'up')).toBe(1);
  });

  it('no DTO has a place for the password or its hash', () => {
    for (const dto of [GuestSiteDto, PublicGuestSiteDto, PublicSiteBlockDto, SiteBlockDto]) {
      const shape = JSON.stringify(z.toJSONSchema(dto, { unrepresentable: 'any' }));
      expect(shape).toContain('"properties"');
      expect(shape).not.toMatch(/passwordHash|passwordVersion|password_hash/i);
    }
    // The public page while locked carries the event's name and nothing else.
    expect(
      PublicGuestSiteDto.parse({ state: 'locked', eventName: 'Wedding', title: 'secret', blocks: [] }),
    ).toEqual({ state: 'locked', eventName: 'Wedding' });
  });
});
