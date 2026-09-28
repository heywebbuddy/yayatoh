import { withTenant } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { reportsForReviewTx, reviewReportCommand } from '@yayatoh/messaging';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Staff review of messaging reports (M1.10d), as apps/admin does it: the cross-org list through
 * platform_reader (every use in the access log) and the review as a platform command in the
 * report's org (audited there under the staff member's actor).
 */
let a: OrgFixture;
let b: OrgFixture;
const STAFF = 'staff:01900000-0000-7000-8000-00000000beef';
const staffCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: STAFF } });
const list = (status: 'open' | 'closed', reason = `test: messaging reports (${status})`) =>
  withPlatformReader({ actor: STAFF, reason }, (tx) => reportsForReviewTx(tx, { status, limit: 500 }));

beforeAll(async () => {
  setPlatformAuditSink(databaseAuditSink);
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('staff review of messaging reports', () => {
  it('lists open reports from every org with an allowlisted excerpt, and logs the read', async () => {
    const reason = `test: open reports ${Date.now()}`;
    const open = await list('open', reason);
    const mine = open.filter((r) => r.orgId === a.org.id || r.orgId === b.org.id);
    // The fixture: one report from each side in each org.
    expect(
      mine
        .filter((r) => r.orgId === a.org.id)
        .map((r) => r.reporter)
        .sort(),
    ).toEqual(['contact', 'organizer']);
    expect(mine.filter((r) => r.orgId === b.org.id)).toHaveLength(2);
    const r = mine.find((x) => x.orgId === a.org.id && x.reporter === 'organizer');
    expect(r).toMatchObject({ orgName: a.org.name, orgSlug: a.org.slug, reason: 'spam', status: 'open' });
    expect(r?.excerpt.map((m) => [m.from, m.text])).toEqual([
      ['organizer', 'Doors at 7'],
      ['contact', 'Is there parking?'],
    ]);
    // Nothing beyond the allowlist: no addresses, user ids or thread ids.
    const json = JSON.stringify(mine);
    expect(json).not.toMatch(/@example\.test/);
    expect(Object.keys(r ?? {}).sort()).toEqual(
      [
        'createdAt',
        'excerpt',
        'id',
        'note',
        'orgId',
        'orgName',
        'orgSlug',
        'reason',
        'reporter',
        'reviewNote',
        'reviewedAt',
        'status',
      ].sort(),
    );
    const [logged] = await withPlatformReader({ actor: STAFF, reason: 'test: read access log' }, (tx) =>
      tx.execute<{ actor: string }>(sql`select actor from platform.access_log where reason = ${reason}`),
    );
    expect(logged?.actor).toBe(STAFF);
  });

  it('resolves and dismisses with a note, audited in the org; twice is refused; members cannot', async () => {
    const open = (await list('open')).filter((r) => r.orgId === a.org.id);
    const [first, second] = open;
    if (!first || !second) throw new Error('fixture reports missing');
    await expect(
      executeCommand(
        reviewReportCommand,
        { reportId: first.id, decision: 'resolved', note: 'x' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        reviewReportCommand,
        { reportId: first.id, decision: 'resolved', note: '  ' },
        staffCtx(a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // Under another org's context the report does not exist (RLS).
    await expect(
      executeCommand(
        reviewReportCommand,
        { reportId: first.id, decision: 'resolved', note: 'x' },
        staffCtx(b.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });

    expect(
      await executeCommand(
        reviewReportCommand,
        { reportId: first.id, decision: 'resolved', note: 'Warned the organizer' },
        staffCtx(a.org.id),
        ports,
      ),
    ).toEqual({ status: 'resolved' });
    await executeCommand(
      reviewReportCommand,
      { reportId: second.id, decision: 'dismissed', note: 'Not abusive' },
      staffCtx(a.org.id),
      ports,
    );
    await expect(
      executeCommand(
        reviewReportCommand,
        { reportId: first.id, decision: 'dismissed', note: 'again' },
        staffCtx(a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'already_reviewed' } });

    const closed = (await list('closed')).filter((r) => r.orgId === a.org.id);
    expect(closed.map((r) => [r.status, r.reviewNote]).sort()).toEqual([
      ['dismissed', 'Not abusive'],
      ['resolved', 'Warned the organizer'],
    ]);
    expect((await list('open')).some((r) => r.orgId === a.org.id)).toBe(false);
    // Org B's reports are untouched.
    expect((await list('open')).filter((r) => r.orgId === b.org.id)).toHaveLength(2);

    const audit = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ action: string; actor: string; target_id: string }>(
        sql`select action, actor, target_id from platform.audit_events where action like 'messaging.report.%' order by seq`,
      ),
    );
    expect(audit.map((x) => [x.action, x.target_id])).toEqual([
      ['messaging.report.resolve', first.id],
      ['messaging.report.dismiss', second.id],
    ]);
    expect(audit.every((x) => x.actor.includes(STAFF))).toBe(true);
  });
});
