import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import {
  charitiesForReviewTx,
  exemptOrgLookupFromEnv,
  rejectCharityCommand,
  saveCharityProfileCommand,
  verifyCharityCommand,
} from '@yayatoh/donations';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Staff review of charity profiles (M4.8b), as the admin app does it (apps/admin/src/server/charities.ts): the cross-org list through
 * platform_reader (every read in the access log), the IRS lookup through the port (the recorded
 * fixture here, never the IRS), and the verdict as a platform command in the org (audited there
 * under the staff member's actor).
 */
let a: OrgFixture;
let b: OrgFixture;
const STAFF = 'staff:01900000-0000-7000-8000-00000000c0de';
const staffCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: STAFF } });
const list = (filter: { status?: 'pending' | 'reviewed'; orgId?: string }, reason: string) =>
  withPlatformReader({ actor: STAFF, reason }, (tx) => charitiesForReviewTx(tx, { ...filter, limit: 500 }));

beforeAll(async () => {
  setPlatformAuditSink(databaseAuditSink);
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('staff review of charity profiles', () => {
  it('lists pending profiles across orgs, allowlisted, and logs the read', async () => {
    const pa = await executeCommand(
      saveCharityProfileCommand,
      { legalName: 'Harbor Arts Alliance', ein: '23-4567891', exemptKind: '501c3' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      saveCharityProfileCommand,
      {
        legalName: 'Pier Kids Project',
        ein: '12-3456789',
        exemptKind: 'fiscal_sponsor',
        sponsorName: 'Good Cause Fiscal Sponsor Inc',
        sponsorEin: '345678912',
      },
      b.ctx(),
      ports,
    );
    const reason = `test: pending charities ${Date.now()}`;
    const pending = (await list({ status: 'pending' }, reason)).filter((p) =>
      [a.org.id, b.org.id].includes(p.orgId),
    );
    expect(pending.map((p) => p.legalName).sort()).toEqual(['Harbor Arts Alliance', 'Pier Kids Project']);
    expect(pending.find((p) => p.orgId === a.org.id)).toMatchObject({
      orgName: a.org.name,
      orgSlug: a.org.slug,
      version: pa.version,
      status: 'pending',
    });
    // Allowlisted: no staff actor, no internal ids beyond the org.
    expect(Object.keys(pending[0] ?? {})).not.toContain('reviewedBy');
    const [logged] = await withPlatformReader({ actor: STAFF, reason: 'test: access log' }, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.access_log where reason = ${reason}`,
      ),
    );
    expect(logged?.n).toBe(1);
  });

  it('verifies against the recorded IRS fixture (the sponsor’s EIN for a sponsored project), audited', async () => {
    const irs = exemptOrgLookupFromEnv({ VITEST: 'true' });
    expect(irs?.source).toBe('fixture');
    expect(exemptOrgLookupFromEnv({})).toBeNull();
    const [mine] = await list({ orgId: b.org.id }, 'test: one charity');
    if (!mine) throw new Error('profile');
    const record = await irs?.lookup(mine.sponsorEin ?? mine.ein);
    if (!record) throw new Error('fixture');
    expect(record.name).toBe('GOOD CAUSE FISCAL SPONSOR INC');
    await executeCommand(
      verifyCharityCommand,
      { version: mine.version, irs: record },
      staffCtx(b.org.id),
      ports,
    );
    const [after] = await list({ orgId: b.org.id }, 'test: one charity');
    expect(after).toMatchObject({ status: 'verified', irsName: 'GOOD CAUSE FISCAL SPONSOR INC' });
    const [audit] = await withPlatformReader({ actor: STAFF, reason: 'test: audit' }, (tx) =>
      tx.execute<{ actor: string }>(
        sql`select actor from platform.audit_events where org_id = ${b.org.id} and action = 'donations.charity.verify' order by created_at desc limit 1`,
      ),
    );
    expect(audit?.actor).toBe(`system:${STAFF}`);
  });

  it('rejects with a note and lists it as reviewed', async () => {
    const [mine] = await list({ orgId: a.org.id }, 'test: one charity');
    if (!mine) throw new Error('profile');
    await executeCommand(
      rejectCharityCommand,
      { version: mine.version, note: 'EIN not on the IRS list.' },
      staffCtx(a.org.id),
      ports,
    );
    const reviewed = await list({ status: 'reviewed' }, 'test: reviewed charities');
    expect(reviewed.find((p) => p.orgId === a.org.id)).toMatchObject({
      status: 'rejected',
      reviewNote: 'EIN not on the IRS list.',
    });
  });
});
