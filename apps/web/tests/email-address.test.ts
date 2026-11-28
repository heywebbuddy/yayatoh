import { expect, it } from 'vitest';
import { isEmailAddress } from '../src/lib/email-address.ts';

it('accepts ordinary addresses', () => {
  expect(isEmailAddress('name@example.com')).toBe(true);
  expect(isEmailAddress('first.last+tag@mail.example.co.uk')).toBe(true);
  expect(isEmailAddress('  name@example.com  ')).toBe(true);
});

it('refuses an address without a dot in the domain (QA #12)', () => {
  expect(isEmailAddress('nitin@gmail')).toBe(false);
});

it('refuses other malformed addresses', () => {
  for (const bad of [
    '',
    'nitin',
    'nitin@',
    '@gmail.com',
    'ni tin@gmail.com',
    'a@b@c.com',
    'a@.com',
    'a@b..com',
    'a@b.c',
  ])
    expect(isEmailAddress(bad), bad).toBe(false);
  expect(isEmailAddress(`${'a'.repeat(320)}@example.com`)).toBe(false);
});
