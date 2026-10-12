import { expect, it } from 'vitest';
import { sendLiveAuthMail } from '../src/lib/auth-mail-policy.ts';

it('uses explicitly configured SES for account codes in local development', () => {
  expect(sendLiveAuthMail(false, 'ses')).toBe(true);
});
it('keeps unconfigured development and fake-provider tests on the console mailer', () => {
  expect(sendLiveAuthMail(false, undefined)).toBe(false);
  expect(sendLiveAuthMail(false, 'fake')).toBe(false);
});
it('requires the configured email transport in production', () => {
  expect(sendLiveAuthMail(true, undefined)).toBe(true);
});
