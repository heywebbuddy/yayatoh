import { describe, expect, it } from 'vitest';
import { keyRequestsPerMinute } from '../src/index.ts';

const q = {
  requestsPerMinute: 600,
  orgRequestsPerMinute: 1200,
  testKeyRequestsPerMinute: 120,
  sandboxRequestsPerMinute: 300,
};

describe('per-key budgets from api_access quotas (M6.3a)', () => {
  it('gives live keys the plan budget, test keys and sandbox orgs smaller ones', () => {
    expect(keyRequestsPerMinute(q, { sandbox: false, orgSandbox: false })).toBe(600);
    expect(keyRequestsPerMinute(q, { sandbox: true, orgSandbox: false })).toBe(120);
    expect(keyRequestsPerMinute(q, { sandbox: false, orgSandbox: true })).toBe(300);
    expect(keyRequestsPerMinute(q, { sandbox: true, orgSandbox: true })).toBe(120);
  });

  it('never gives a test or sandbox key more than a live key', () => {
    const tight = { ...q, requestsPerMinute: 50 };
    expect(keyRequestsPerMinute(tight, { sandbox: true, orgSandbox: false })).toBe(50);
    expect(keyRequestsPerMinute(tight, { sandbox: false, orgSandbox: true })).toBe(50);
  });
});
