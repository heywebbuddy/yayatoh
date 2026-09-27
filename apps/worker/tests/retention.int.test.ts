import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { executeQuery } from '@yayatoh/kernel';
import { auditLogQuery } from '@yayatoh/platform';
import { ports, twoOrgs } from '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRetention } from '../src/retention.ts';

const audited: string[] = [];
beforeAll(() => setPlatformAuditSink(async ({ actor, reason }) => void audited.push(`${actor}|${reason}`)));
afterAll(closePools);

describe('daily retention job (M1.14c)', () => {
  it('runs every org as a system actor, audits the platform read, purges rate limits', async () => {
    const { a, b } = await twoOrgs();
    const r = await runRetention();
    expect(r.orgs).toBeGreaterThanOrEqual(2);
    expect(r.failed).toBe(0);
    expect(typeof r.rateLimits).toBe('number');
    // Without an off-account archive, the access log is never purged.
    expect(r.accessLog).toBeNull();
    expect(audited.some((x) => x.startsWith('system:retention|list organizations'))).toBe(true);
    for (const o of [a, b]) {
      const log = await executeQuery(
        auditLogQuery,
        { filter: { action: 'privacy.retention' } },
        o.ctx(),
        ports,
      );
      expect(log.entries[0]?.actor).toBe('system:privacy.retention');
    }
  });

  it('purges the access log only when archived, and never inside 12 months', async () => {
    const admin = adminClient();
    try {
      await expect(admin`select platform.purge_access_log(now() - interval '1 month')`).rejects.toThrow(
        /keep at least 12 months/,
      );
      process.env.ACCESS_LOG_ARCHIVED = '1';
      const { a } = await twoOrgs();
      const r = await runRetention({ onlyOrgs: [a.org.id] });
      expect(r.accessLog).toEqual(expect.any(Number));
    } finally {
      delete process.env.ACCESS_LOG_ARCHIVED;
      await admin.end();
    }
  });
});
