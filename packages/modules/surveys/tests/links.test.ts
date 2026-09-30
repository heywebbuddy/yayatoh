import { verifyLinkToken } from '@yayatoh/platform';
import { describe, expect, it } from 'vitest';
import { SURVEY_PURPOSE, surveyToken } from '../src/surveys.ts';

const SECRET = 'survey-unit-test-secret-0123456789abcdef';
const ID = '0192f1a2-7b3c-7d4e-8f90-123456789abc';

describe('survey links', () => {
  process.env.APP_TOKEN_SECRET = SECRET;

  it('sign the invitation id for the survey purpose only', () => {
    const token = surveyToken(ID);
    expect(token.startsWith(`${ID}~`)).toBe(true);
    expect(token).not.toContain('.');
    expect(verifyLinkToken(SURVEY_PURPOSE, token, SECRET)).toBe(ID);
    // Another purpose's key does not open a survey (and vice versa).
    expect(verifyLinkToken('messaging.thread', token, SECRET)).toBeNull();
  });

  it('refuse tampered ids, signatures and other secrets', () => {
    const token = surveyToken(ID);
    const other = `${ID.slice(0, -1)}d${token.slice(ID.length)}`;
    expect(verifyLinkToken(SURVEY_PURPOSE, other, SECRET)).toBeNull();
    expect(verifyLinkToken(SURVEY_PURPOSE, `${token.slice(0, -2)}xx`, SECRET)).toBeNull();
    expect(verifyLinkToken(SURVEY_PURPOSE, token, `${SECRET}-rotated`)).toBeNull();
    expect(verifyLinkToken(SURVEY_PURPOSE, 'not-a-token', SECRET)).toBeNull();
  });
});
