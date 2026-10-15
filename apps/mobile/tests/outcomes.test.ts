import { digitsOnly } from '../src/auth/code-input';
import { messageFor, minutesFor, needsStartOver, START_OVER, waitSeconds } from '../src/auth/outcomes';
import { href, PATHS } from '../src/auth/routes';

describe('minutesFor', () => {
  it('rounds a wait up to whole minutes and never shows zero', () => {
    expect(minutesFor(1)).toBe(1);
    expect(minutesFor(60)).toBe(1);
    expect(minutesFor(61)).toBe(2);
    expect(minutesFor(15 * 60)).toBe(15);
    expect(minutesFor(0)).toBe(1);
  });
});

describe('messageFor', () => {
  it('shows the time to wait for a rate limit, and a plain message when the server gave none', () => {
    expect(messageFor({ kind: 'rateLimited', retryAfterSeconds: 300 })).toEqual({
      key: 'core.signIn.rateLimited',
      values: { minutes: 5 },
    });
    expect(messageFor({ kind: 'rateLimited', retryAfterSeconds: null })).toEqual({
      key: 'signIn.rateLimitedNoTime',
    });
  });

  it('gives each failure its own message', () => {
    for (const reason of [
      'invalid_credentials',
      'invalid_code',
      'too_many_attempts',
      'invalid_challenge',
      'invalid_id_token',
      'provider_email_missing',
      'provider_email_unverified',
      'provider_linked_elsewhere',
      'unknown',
    ] as const)
      expect(messageFor({ kind: 'failed', reason })).toEqual({ key: `core.signIn.failed.${reason}` });
  });

  it('says an emailed code is wrong or expired, since the server cannot tell them apart', () => {
    expect(messageFor({ kind: 'failed', reason: 'invalid_code' }, { emailedCode: true })).toEqual({
      key: 'signIn.code.wrongOrExpired',
    });
    // Other failures keep their message even for an emailed code.
    expect(messageFor({ kind: 'failed', reason: 'too_many_attempts' }, { emailedCode: true })).toEqual({
      key: 'core.signIn.failed.too_many_attempts',
    });
  });

  it('has a message for an offline phone and for a sheet this phone does not have', () => {
    expect(messageFor({ kind: 'unavailable' })).toEqual({ key: 'core.signIn.unavailable' });
    expect(messageFor({ kind: 'unsupported' })).toEqual({ key: 'core.signIn.unsupported' });
  });

  it('shows nothing for a finished or cancelled sign-in, or a step that has its own screen', () => {
    expect(messageFor({ kind: 'cancelled' })).toBeNull();
    expect(
      messageFor({ kind: 'signedIn', user: { id: 'u', email: 'a@b.test', emailVerified: true, name: 'A' } }),
    ).toBeNull();
    expect(messageFor({ kind: 'twoFactor', challenge: 'c', expiresAt: null })).toBeNull();
    expect(messageFor({ kind: 'sent', expiresInSeconds: 600 })).toBeNull();
  });

  it('knows the wrong password of a step-up', () => {
    expect(messageFor({ kind: 'failed', reason: 'invalid_password' })).toEqual({
      key: 'core.stepUp.invalid_password',
    });
  });
});

describe('starting over and waiting', () => {
  it('a spent challenge or too many wrong codes means start over; a wrong code does not', () => {
    expect([...START_OVER]).toEqual(['too_many_attempts', 'invalid_challenge']);
    expect(needsStartOver({ kind: 'failed', reason: 'too_many_attempts' })).toBe(true);
    expect(needsStartOver({ kind: 'failed', reason: 'invalid_challenge' })).toBe(true);
    expect(needsStartOver({ kind: 'failed', reason: 'invalid_code' })).toBe(false);
    expect(needsStartOver({ kind: 'unavailable' })).toBe(false);
  });

  it('reads the wait out of a rate limit only', () => {
    expect(waitSeconds({ kind: 'rateLimited', retryAfterSeconds: 90 })).toBe(90);
    expect(waitSeconds({ kind: 'rateLimited', retryAfterSeconds: null })).toBeNull();
    expect(waitSeconds({ kind: 'unavailable' })).toBeNull();
  });
});

describe('digitsOnly', () => {
  it('cleans a pasted or autofilled code down to six digits', () => {
    expect(digitsOnly('123 456')).toBe('123456');
    expect(digitsOnly(' 12-34-56 ')).toBe('123456');
    expect(digitsOnly('1234567890')).toBe('123456');
    expect(digitsOnly('abc')).toBe('');
    expect(digitsOnly('١٢٣٤٥٦')).toBe('');
  });
});

describe('routes', () => {
  it('every route this increment owns is an absolute path', () => {
    for (const path of Object.values(PATHS)) expect(href(path)).toMatch(/^\//);
  });
});
