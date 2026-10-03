import { withTenant } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { chatReportsForReviewTx, reviewChatReportCommand } from '@yayatoh/engagement';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Staff review of networking chat reports (M5.8b into the M1.10d queue), as apps/admin does it:
 * the cross-org list through platform_reader (every use in the access log) and the review as a
 * platform command in the report's org (audited there under the staff member's actor).
 */
let a: OrgFixture;
let b: OrgFixture;
const STAFF = 'staff:01900000-0000-7000-8000-00000000c4a7';
const staffCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: STAFF } });
const list = (status: 'open' | 'closed', reason = `test: chat reports (${status})`) =>
  withPlatformReader({ actor: STAFF, reason }, (tx) => chatReportsForReviewTx(tx, { status, limit: 500 }));

beforeAll(async () => {
  setPlatformAuditSink(databaseAuditSink);
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('staff review of networking chat reports', () => {
  it('lists open chat reports from every org with an excerpt labelled by side, and logs the read', async () => {
    const reason = `test: open chat reports ${Date.now()}`;
    const mine = (await list('open', reason)).filter((r) => r.orgId === a.org.id || r.orgId === b.org.id);
    // The fixture: one direct-chat report per org (the organizer dismissed it; staff still review).
    expect(mine.filter((r) => r.orgId === a.org.id)).toHaveLength(1);
    expect(mine.filter((r) => r.orgId === b.org.id)).toHaveLength(1);
    const r = mine.find((x) => x.orgId === a.org.id);
    expect(r).toMatchObject({
      orgName: a.org.name,
      orgSlug: a.org.slug,
      kind: 'direct',
      reporter: 'attendee',
      reason: 'spam',
      details: 'Fixture chat report.',
      moderation: 'dismissed',
      status: 'open',
    });
    expect(r?.excerpt.map((m) => [m.from, m.text])).toEqual([
      ['reporter', 'Hi Ben, see you soon!'],
      ['reported', 'Likewise.'],
    ]);
    // Nothing beyond the allowlist: no names, addresses or other ids.
    const json = JSON.stringify(mine);
    expect(json).not.toMatch(/@/);
    expect(json).not.toMatch(/(Ana|Ben) Fixture/);
    expect(Object.keys(r ?? {}).sort()).toEqual(
      [
        'createdAt',
        'details',
        'excerpt',
        'id',
        'kind',
        'moderation',
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

  it('resolves with a note, audited in the org; twice is refused; members and other orgs cannot', async () => {
    const [first] = (await list('open')).filter((r) => r.orgId === a.org.id);
    if (!first) throw new Error('fixture chat report missing');
    await expect(
      executeCommand(
        reviewChatReportCommand,
        { reportId: first.id, decision: 'resolved', note: 'x' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        reviewChatReportCommand,
        { reportId: first.id, decision: 'resolved', note: ' ' },
        staffCtx(a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        reviewChatReportCommand,
        { reportId: first.id, decision: 'resolved', note: 'x' },
        staffCtx(b.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(
      await executeCommand(
        reviewChatReportCommand,
        { reportId: first.id, decision: 'resolved', note: 'Warned the attendee' },
        staffCtx(a.org.id),
        ports,
      ),
    ).toEqual({ status: 'resolved' });
    await expect(
      executeCommand(
        reviewChatReportCommand,
        { reportId: first.id, decision: 'dismissed', note: 'again' },
        staffCtx(a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'already_reviewed' } });
    const closed = (await list('closed')).filter((r) => r.orgId === a.org.id);
    expect(closed.map((r) => [r.status, r.reviewNote])).toEqual([['resolved', 'Warned the attendee']]);
    expect((await list('open')).filter((r) => r.orgId === b.org.id)).toHaveLength(1);
    const audit = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ action: string; actor: string; target_id: string }>(
        sql`select action, actor, target_id from platform.audit_events where action like 'engagement.chat_report.%' order by seq`,
      ),
    );
    expect(audit.map((x) => [x.action, x.target_id])).toEqual([['engagement.chat_report.resolve', first.id]]);
    expect(audit.every((x) => x.actor.includes(STAFF))).toBe(true);
  });
});
