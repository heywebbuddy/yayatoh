import { describe, expect, it } from 'vitest';
import { reviewerFixedCodes } from '../src/index.ts';

describe('reviewerFixedCodes (M7.5a)', () => {
  const env = { REVIEWER_DEMO_EMAIL: 'App-Review@Yayatoh.test ', REVIEWER_DEMO_CODE: ' 424242 ' };

  it('maps the reviewer demo address (lower-cased) to its six digits', () => {
    expect(reviewerFixedCodes(env)).toEqual({ 'app-review@yayatoh.test': '424242' });
  });

  it('gives nothing in production, whatever is set', () => {
    expect(reviewerFixedCodes({ ...env, YAYATOH_ENV: 'production' })).toBeUndefined();
    expect(reviewerFixedCodes({ ...env, VERCEL_ENV: 'production' })).toBeUndefined();
  });

  it('gives nothing unless both values are set and the code is exactly six digits', () => {
    expect(reviewerFixedCodes({})).toBeUndefined();
    expect(reviewerFixedCodes({ REVIEWER_DEMO_EMAIL: 'a@b.test' })).toBeUndefined();
    expect(reviewerFixedCodes({ REVIEWER_DEMO_CODE: '123456' })).toBeUndefined();
    for (const code of ['12345', '1234567', 'abcdef', '12 456'])
      expect(reviewerFixedCodes({ ...env, REVIEWER_DEMO_CODE: code }), code).toBeUndefined();
  });

  it('works on a staging server (YAYATOH_ENV is not production)', () => {
    expect(reviewerFixedCodes({ ...env, YAYATOH_ENV: 'staging' })).toEqual({
      'app-review@yayatoh.test': '424242',
    });
  });
});
