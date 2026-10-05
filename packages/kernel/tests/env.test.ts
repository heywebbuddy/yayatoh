import { describe, expect, it } from 'vitest';
import { isProductionEnv } from '../src/index.ts';

describe('isProductionEnv', () => {
  it('is true for self-hosted production (YAYATOH_ENV) and for Vercel production', () => {
    expect(isProductionEnv({ YAYATOH_ENV: 'production' })).toBe(true);
    expect(isProductionEnv({ VERCEL_ENV: 'production' })).toBe(true);
  });

  it('is false for previews, staging, development and an empty environment', () => {
    expect(isProductionEnv({})).toBe(false);
    expect(isProductionEnv({ YAYATOH_ENV: 'staging' })).toBe(false);
    expect(isProductionEnv({ VERCEL_ENV: 'preview' })).toBe(false);
    expect(isProductionEnv({ YAYATOH_ENV: 'Production' })).toBe(false);
  });

  it('reads process.env when no environment is given', () => {
    const prior = process.env.YAYATOH_ENV;
    process.env.YAYATOH_ENV = 'production';
    try {
      expect(isProductionEnv()).toBe(true);
    } finally {
      if (prior === undefined) delete process.env.YAYATOH_ENV;
      else process.env.YAYATOH_ENV = prior;
    }
  });
});
