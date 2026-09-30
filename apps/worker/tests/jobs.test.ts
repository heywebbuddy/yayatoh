import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineJob, parseJobPayload } from '../src/jobs.ts';

const tenantJob = defineJob({
  name: 'ticketing.send-confirmation',
  scope: 'tenant',
  payload: z.object({ orgId: z.uuid(), orderId: z.string() }),
  handler: async () => {},
});

describe('job guard', () => {
  it('rejects a tenant job without an orgId', () => {
    expect(() => parseJobPayload(tenantJob, { orderId: 'o1' })).toThrow(/job guard/);
  });
  it('accepts a tenant job with a valid orgId', () => {
    const p = parseJobPayload(tenantJob, { orgId: '0190f5f6-0000-7000-8000-00000000000a', orderId: 'o1' });
    expect(p.orderId).toBe('o1');
  });
  it('enforces dotted job names', () => {
    expect(() => defineJob({ ...tenantJob, name: 'Bad Name' })).toThrow();
  });
});
