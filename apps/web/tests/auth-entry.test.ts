import { expect, it } from 'vitest';
import { authEntryDestination } from '../src/lib/auth-entry.ts';
import { isPrivatePage } from '../src/lib/seo/robots.ts';

it('keeps both attendee registration and organizer login private on the marketplace', () => {
  expect(isPrivatePage('marketplace', '/sign-up')).toBe(true);
  expect(isPrivatePage('marketplace', '/o/sign-in')).toBe(true);
  expect(isPrivatePage('marketplace', '/o/sign-in/sso')).toBe(true);
});

it('keeps attendee sign-ins out of the organization console', () => {
  expect(authEntryDestination('attendee', '/attendee', '/o/company')).toBe('/attendee');
  expect(authEntryDestination('attendee', '/attendee', '/attendee/tickets')).toBe('/attendee/tickets');
});
it('keeps organization sign-ins out of the attendee dashboard', () => {
  expect(authEntryDestination('organizer', '/o/company', '/attendee/profile')).toBe('/o/company');
  expect(authEntryDestination('organizer', '/o/company', '/o/company/events')).toBe('/o/company/events');
});
it('rejects external destinations and authentication redirect loops', () => {
  for (const next of [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/sign-up',
    '/sign-in?next=/o',
    '/o/sign-in',
  ])
    expect(authEntryDestination('attendee', '/attendee', next)).toBe('/attendee');
});
