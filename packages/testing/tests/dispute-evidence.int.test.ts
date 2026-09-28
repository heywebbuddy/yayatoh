import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { applyDisputeEventCommand } from '@yayatoh/orders';
import {
  disputesQuery,
  fakePaymentProvider,
  markOrgEvidenceSubmittedCommand,
  saveEvidenceDraftCommand,
} from '@yayatoh/payments';
import { disputeEvidenceHtml } from '@yayatoh/pdf';
import { disputeEvidenceQuery, evidenceDocument } from '@yayatoh/reports';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * The dispute evidence packet, reviewed and submitted by the organizer (M1.6e): built from the
 * order, its tickets, the door's scan log (access log) and the messages sent; the reviewer writes
 * a statement, leaves optional sections out, and submits once through the payment port.
 */
let a: OrgFixture;
let b: OrgFixture;
let financeId: string;
let disputeId: string;

const label = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ''}`;
const toDoc = (ev: Awaited<ReturnType<typeof evidence>>) =>
  evidenceDocument(ev, { locale: 'en', label, money: (m, c) => `${c} ${m}` });
const evidence = (ctx = a.ctx()) => executeQuery(disputeEvidenceQuery, { disputeId }, ctx, ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  financeId = uuidv7();
  await executeCommand(addMemberCommand, { userId: financeId, role: 'finance' }, a.ctx(), ports);
  // The fixture's paid order (its ticket was scanned at two entrances) is disputed again.
  const [order] = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ total_minor: string }>(
      sql`select total_minor::text from orders.orders where provider_payment_id = ${`fakepi_${a.org.slug}`}`,
    ),
  );
  await executeCommand(
    applyDisputeEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_ev_${a.org.slug}`,
      type: 'dispute.created',
      orgId: a.org.id,
      providerPaymentId: `fakepi_${a.org.slug}`,
      providerDisputeId: `fakedp_ev_${a.org.slug}`,
      amountMinor: Number(order?.total_minor),
      currency: 'USD',
      reason: 'product_not_received',
      evidenceDueBy: '2030-01-01T00:00:00Z',
    },
    systemCtx(a.org.id),
    ports,
  );
  const open = (await executeQuery(disputesQuery, {}, a.ctx(), ports)).find((d) => d.status === 'open');
  if (!open) throw new Error('no open dispute');
  disputeId = open.id;
});
afterAll(closePools);

describe('dispute evidence review (M1.6e)', () => {
  it('the packet carries the access log (every door scan, with the entrance) and the messages sent', async () => {
    const ev = await evidence();
    expect(ev.scans.length).toBeGreaterThanOrEqual(2);
    expect(ev.scans.every((s) => s.serial > 0)).toBe(true);
    expect(ev.scans.map((s) => s.checkpoint)).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(ev.scans.map((s) => s.result)).toContain('admitted');
    expect(ev.review).toEqual({ summary: null, excluded: [] });
    const doc = toDoc(ev);
    expect(doc.sections.map((s) => s.id)).toEqual([
      'dispute',
      'seller',
      'event',
      'order',
      'tickets',
      'accessLog',
      'refunds',
      'messages',
      'refundPolicy',
    ]);
  });

  it('owners and finance save a statement and leave sections out; viewers and other orgs cannot', async () => {
    const draft = { disputeId, summary: 'The buyer entered at 19:02 (north gate).', excluded: ['messages'] };
    await expect(
      executeCommand(saveEvidenceDraftCommand, draft, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeCommand(saveEvidenceDraftCommand, draft, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeCommand(saveEvidenceDraftCommand, { ...draft, excluded: ['order'] }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const saved = await executeCommand(saveEvidenceDraftCommand, draft, userCtx(financeId, a.org.id), ports);
    expect(saved).toMatchObject({ evidenceSummary: draft.summary, evidenceExcluded: ['messages'] });
    const doc = toDoc(await evidence());
    // The statement leads; the excluded section is gone; the rest stays, escaped.
    expect(doc.sections[0]).toMatchObject({ id: 'statement', text: draft.summary });
    expect(doc.sections.some((s) => s.id === 'messages')).toBe(false);
    expect(disputeEvidenceHtml(doc)).toContain('north gate');
  });

  it('submits once through the port with the reviewed statement; audited; the packet size is enforced', async () => {
    const fake = fakePaymentProvider({ secret: 'e'.repeat(40), appOrigin: 'http://localhost' });
    const [d] = await executeQuery(disputesQuery, {}, a.ctx(), ports).then((ds) =>
      ds.filter((x) => x.id === disputeId),
    );
    const big = await fake.submitDisputeEvidence({
      providerDisputeId: d?.providerDisputeId ?? '',
      summary: 'Too big',
      packet: { bytes: new Uint8Array(4_500_001), filename: 'x.pdf' },
      idempotencyKey: `evidence:${disputeId}:big`,
    });
    expect(big.status).toBe('failed');
    const sent = await fake.submitDisputeEvidence({
      providerDisputeId: d?.providerDisputeId ?? '',
      summary: 'The buyer entered at 19:02 (north gate).',
      packet: { bytes: new TextEncoder().encode('%PDF'), filename: 'evidence.pdf' },
      idempotencyKey: `evidence:${disputeId}`,
    });
    expect(sent.status).toBe('submitted');

    const input = { disputeId, summary: 'The buyer entered at 19:02 (north gate).', excluded: ['messages'] };
    await expect(
      executeCommand(markOrgEvidenceSubmittedCommand, { ...input, summary: 'short' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(markOrgEvidenceSubmittedCommand, input, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const done = await executeCommand(
      markOrgEvidenceSubmittedCommand,
      input,
      userCtx(financeId, a.org.id),
      ports,
    );
    expect(done).toMatchObject({ status: 'evidence_submitted', evidenceSubmittedAt: expect.any(Date) });
    await expect(
      executeCommand(markOrgEvidenceSubmittedCommand, input, a.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'dispute_not_open' },
    });
    await expect(
      executeCommand(saveEvidenceDraftCommand, { disputeId, summary: 'later' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    const [audit] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ data: { by: string } }>(
        sql`select data from platform.audit_events where action = 'dispute.evidence_submitted' and target_id = ${disputeId}`,
      ),
    );
    expect(audit?.data.by).toBe('organizer');
  });
});
