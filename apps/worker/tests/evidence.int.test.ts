import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { executeQuery } from '@yayatoh/kernel';
import { auditLogQuery } from '@yayatoh/platform';
import { ports, twoOrgs } from '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleAuditLog } from '../src/evidence.ts';

const audited: string[] = [];
beforeAll(() => setPlatformAuditSink(async ({ actor, reason }) => void audited.push(`${actor}|${reason}`)));
afterAll(closePools);

describe('evidence audit-log samples (M5.11a)', () => {
  it("reads only the listed orgs, through each org's own Activity query, with an audited lookup", async () => {
    const { a, b } = await twoOrgs();
    const s = await sampleAuditLog({ slugs: [a.org.slug], perOrg: 100 });
    expect(s.source).toBe('seeded-ci-database');
    expect(s.orgs.map((o) => o.slug)).toEqual([a.org.slug]);
    expect(audited).toContain('system:evidence|SOC 2 evidence bundle: audit-log sample of seeded orgs');

    const own = await executeQuery(auditLogQuery, { limit: 100 }, a.ctx(), ports);
    const other = await executeQuery(auditLogQuery, { limit: 100 }, b.ctx(), ports);
    const sample = s.orgs[0];
    expect(sample?.chain).toEqual(own.chain);
    expect(sample?.chain.verified).toBe(true);
    expect(sample?.entries.map((e) => e.seq)).toEqual(own.entries.map((e) => e.seq));
    // Nothing of the other org, by target or by chain.
    // (Row targets only: null and vocabulary targets like a currency code are shared by design.)
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/;
    const otherRows = new Set(
      other.entries.flatMap((e) => (e.targetId && UUID.test(e.targetId) ? [e.targetId] : [])),
    );
    expect(otherRows.size).toBeGreaterThan(0);
    expect(sample?.entries.filter((e) => e.targetId && otherRows.has(e.targetId))).toEqual([]);
    expect(sample?.chain.head).not.toBe(other.chain.head);
  });

  it('carries only the allowlisted entry fields: no raw data, names or emails', async () => {
    const { a } = await twoOrgs();
    const s = await sampleAuditLog({ slugs: [a.org.slug], perOrg: 100 });
    for (const e of s.orgs[0]?.entries ?? []) {
      expect(Object.keys(e).sort()).toEqual([
        'action',
        'actor',
        'at',
        'details',
        'seq',
        'targetId',
        'targetType',
      ]);
      expect(JSON.stringify(e)).not.toMatch(/@/);
    }
  });

  it('an unknown slug yields nothing; the production run is stamped as such', async () => {
    expect((await sampleAuditLog({ slugs: ['no-such-org-evidence'] })).orgs).toEqual([]);
    const { a } = await twoOrgs();
    const p = await sampleAuditLog({ slugs: [a.org.slug], production: true, perOrg: 1 });
    expect(p.source).toBe('production-owner-run');
    expect(p.orgs[0]?.entries).toHaveLength(1);
    expect(audited).toContain(
      'system:evidence|SOC 2 evidence: owner-run audit-log sample of auditor-selected orgs',
    );
  });
});
