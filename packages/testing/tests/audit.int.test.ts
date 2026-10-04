import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  AUDIT_EXPORT_COLUMNS,
  auditDetails,
  auditExportBulk,
  auditLogQuery,
  verifyAuditChainTx,
} from '@yayatoh/platform';
import { addMemberCommand, updateOrganizationCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bareOrg, type OrgFixture, runBulk, twoOrgs, userCtx } from '../src/index.ts';
import { ports } from '../src/ports.ts';

let a: OrgFixture;
let b: OrgFixture;
let adminId: string;
let managerId: string;
let financeId: string;

const HEADERS = {
  seq: '#',
  at: 'When',
  actor: 'Who',
  action: 'What',
  targetType: 'Target type',
  targetId: 'Target',
  details: 'Details',
};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  adminId = uuidv7();
  managerId = uuidv7();
  financeId = uuidv7();
  for (const [userId, role] of [
    [adminId, 'admin'],
    [managerId, 'manager'],
    [financeId, 'finance'],
  ] as const)
    await executeCommand(addMemberCommand, { userId, role }, a.ctx(), ports);
});
afterAll(closePools);

const page = (ctx = a.ctx(), input: Record<string, unknown> = {}) =>
  executeQuery(auditLogQuery, input, ctx, ports);

describe('audit hash chain', () => {
  it('numbers each org’s entries gap-free and links every hash to the previous one', async () => {
    const rows = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ seq: number; hash: string; prev_hash: string }>(
        sql`select seq::int, hash, prev_hash from platform.audit_events order by seq`,
      ),
    );
    expect(rows.length).toBeGreaterThan(3);
    rows.forEach((r, i) => {
      expect(r.seq).toBe(i + 1);
      expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.prev_hash).toBe(i === 0 ? '' : rows[i - 1]?.hash);
    });
    const status = await withTenant(a.ctx(), verifyAuditChainTx);
    expect(status).toMatchObject({
      verified: true,
      entries: rows.length,
      brokenAt: null,
      head: rows.at(-1)?.hash,
    });
  });

  it('stays gap-free and valid under 20 concurrent commands', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        executeCommand(updateOrganizationCommand, { name: `Alpha ${i}` }, a.ctx(), ports),
      ),
    );
    const status = await withTenant(a.ctx(), verifyAuditChainTx);
    expect(status.verified).toBe(true);
    const [row] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ n: number; max: number }>(
        sql`select count(*)::int as n, max(seq)::int as max from platform.audit_events`,
      ),
    );
    expect(row?.n).toBe(row?.max);
  });

  it('detects an edited, a deleted and a re-hashed entry (tampering needs superuser: app_user can’t)', async () => {
    await expect(
      withTenant(a.ctx(), (tx) => tx.execute(sql`update platform.audit_events set action = 'x'`)),
    ).rejects.toThrow();
    const admin = adminClient();
    try {
      // A throwaway org of its own so the tampering never affects other tests (a bare org: the
      // chain needs only a few entries, and a full fixture no longer fits the test's time).
      const t = await bareOrg(`tamper-${uuidv7().slice(-8)}`, 'Tamper Org');
      for (let i = 0; i < 3; i++)
        await executeCommand(updateOrganizationCommand, { name: `Tamper ${i}` }, t.ctx(), ports);
      const status0 = await withTenant(t.ctx(), verifyAuditChainTx);
      expect(status0.verified).toBe(true);

      // 1. Edit the data of entry #2.
      await admin`update platform.audit_events set data = '{"forged":true}' where org_id = ${t.orgId} and seq = 2`;
      expect(await withTenant(t.ctx(), verifyAuditChainTx)).toMatchObject({ verified: false, brokenAt: 2 });

      // 2. Re-hash #2 to hide the edit: the link from #3 now breaks.
      await admin`update platform.audit_events set hash = platform.audit_hash(prev_hash, org_id, seq, actor, action, target_type, target_id, data, request_id, created_at) where org_id = ${t.orgId} and seq = 2`;
      expect(await withTenant(t.ctx(), verifyAuditChainTx)).toMatchObject({ verified: false, brokenAt: 3 });

      // 3. Delete an entry in the middle: the numbering and the link break.
      const u = await bareOrg(`delete-${uuidv7().slice(-8)}`, 'Delete Org');
      for (let i = 0; i < 3; i++)
        await executeCommand(updateOrganizationCommand, { name: `Delete ${i}` }, u.ctx(), ports);
      await admin`delete from platform.audit_events where org_id = ${u.orgId} and seq = 2`;
      expect(await withTenant(u.ctx(), verifyAuditChainTx)).toMatchObject({ verified: false, brokenAt: 3 });
    } finally {
      await admin.end();
    }
    // Two fresh org fixtures (about 18 s each since batch 3j) don't fit the default 30 s.
  }, 120_000);
});

describe('Settings → Activity (auditLogQuery)', () => {
  it('owners and admins read it; managers, finance and viewers are refused', async () => {
    expect((await page()).entries.length).toBeGreaterThan(0);
    expect((await page(userCtx(adminId, a.org.id))).entries.length).toBeGreaterThan(0);
    for (const id of [managerId, financeId, a.viewerId])
      await expect(page(userCtx(id, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
    // A member of another org gets nothing of this org.
    await expect(page(userCtx(b.ownerId, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('never shows another org’s entries', async () => {
    const mine = await page(b.ctx(), { limit: 100 });
    expect(mine.actors).not.toContain(`user:${a.ownerId}`);
    const leak = await page(b.ctx(), { filter: { actor: `user:${a.ownerId}` } });
    expect(leak.entries).toEqual([]);
    expect(mine.chain.verified).toBe(true);
  });

  it('filters by actor, action and date range, and pages newest first by seq', async () => {
    const all = await page(a.ctx(), { limit: 100 });
    expect(all.actions).toContain('membership.add');
    const adds = await page(a.ctx(), { filter: { action: 'membership.add' } });
    // The fixture's viewer plus the admin, manager and finance members added here.
    expect(adds.entries.length).toBe(4);
    expect(adds.entries.every((e) => e.action === 'membership.add')).toBe(true);
    const byOwner = await page(a.ctx(), { filter: { actor: `user:${a.ownerId}` }, limit: 100 });
    expect(byOwner.entries.every((e) => e.actor === `user:${a.ownerId}`)).toBe(true);
    const future = await page(a.ctx(), { filter: { from: new Date(Date.now() + 86_400_000) } });
    expect(future.entries).toEqual([]);
    const past = await page(a.ctx(), { filter: { to: new Date('2000-01-01') } });
    expect(past.entries).toEqual([]);

    const first = await page(a.ctx(), { limit: 5 });
    expect(first.entries.map((e) => e.seq)).toEqual(
      [...first.entries.map((e) => e.seq)].sort((x, y) => y - x),
    );
    expect(first.nextBefore).toBe(first.entries.at(-1)?.seq);
    const second = await page(a.ctx(), { limit: 5, before: first.nextBefore });
    expect(second.entries[0]?.seq).toBe((first.nextBefore ?? 0) - 1);
    const seen = new Set<number>();
    let before: number | undefined;
    for (;;) {
      const p = await page(a.ctx(), { limit: 7, ...(before ? { before } : {}) });
      for (const e of p.entries) {
        expect(seen.has(e.seq)).toBe(false);
        seen.add(e.seq);
      }
      if (p.nextBefore === null) break;
      before = p.nextBefore;
    }
    expect(seen.size).toBe(all.chain.entries);
  });

  it('returns allowlisted fields only: no raw data, no emails or free text', async () => {
    const all = await page(a.ctx(), { limit: 100 });
    for (const e of all.entries) {
      expect(Object.keys(e).sort()).toEqual([
        'action',
        'actor',
        'at',
        'details',
        'id',
        'seq',
        'targetId',
        'targetType',
      ]);
      expect(JSON.stringify(e.details)).not.toMatch(/@/);
    }
    expect(
      auditDetails({ role: 'admin', email: 'x@y.z', reason: 'Because I said so', total: 3, name: 'Pat' }),
    ).toEqual({
      role: 'admin',
      total: 3,
    });
    expect(auditDetails({ reason: 'requested_by_customer', status: 'a@b.c' })).toEqual({
      reason: 'requested_by_customer',
    });
  });
});

describe('Activity CSV export (bulk framework)', () => {
  const start = (ctx = a.ctx(), filter: Record<string, unknown> = {}) =>
    executeCommand(
      auditExportBulk.start,
      {
        selection: { filter },
        params: {
          headers: HEADERS,
          timeZone: 'America/Chicago',
          actorNames: { [`user:${a.ownerId}`]: '=HYPERLINK("x")' },
        },
      },
      ctx,
      ports,
    );

  it('exports the filtered entries with allowlisted columns, in the org timezone, injection-safe', async () => {
    const { operationId, total } = await start(a.ctx(), { action: 'membership.add' });
    expect(total).toBe(4);
    expect(await runBulk(a.org.id, operationId)).toBe('done');
    const file = await executeQuery(auditExportBulk.file, { operationId }, a.ctx(), ports);
    expect(file.name).toMatch(/^activity-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = file.content.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe(AUDIT_EXPORT_COLUMNS.map((c) => HEADERS[c]).join(','));
    expect(lines).toHaveLength(5);
    for (const l of lines.slice(1)) {
      expect(l).toMatch(/^\d+,\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},/);
      expect(l).toContain('membership.add');
      // The owner's display name is neutralized as a formula.
      expect(l).toContain(`'=HYPERLINK`);
      expect(l).not.toMatch(/@/);
    }
  });

  it('refuses viewers and managers, id lists, and another org reading the operation', async () => {
    await expect(start(userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(start(userCtx(managerId, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        auditExportBulk.start,
        { selection: { ids: [uuidv7()] }, params: { headers: HEADERS, timeZone: 'UTC' } },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const { operationId } = await start();
    await runBulk(a.org.id, operationId);
    await expect(executeQuery(auditExportBulk.file, { operationId }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    // The export itself is audited.
    const log = await page(a.ctx(), { filter: { action: 'bulk.start' } });
    expect(log.entries.some((e) => e.details.action === 'platform.auditCsv')).toBe(true);
  });
});
