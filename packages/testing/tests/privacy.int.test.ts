import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import { auditLogQuery, ERASED_EMAIL, verifyAuditChainTx } from '@yayatoh/platform';
import {
  dsarExportBulk,
  dsarHistoryQuery,
  eraseSubjectCommand,
  findSubjectQuery,
  maskEmail,
  retentionCommand,
} from '@yayatoh/privacy';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';
import { ports } from '../src/ports.ts';

let a: OrgFixture;
let b: OrgFixture;
let managerId: string;
const buyer = (o: OrgFixture) => `buyer@${o.org.slug}.test`;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  managerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: managerId, role: 'manager' }, a.ctx(), ports);
});
afterAll(closePools);

const find = (email: string, ctx = a.ctx()) => executeQuery(findSubjectQuery, { email }, ctx, ports);

async function exportFor(email: string, ctx = a.ctx(), orgId = a.org.id) {
  const { operationId } = await executeCommand(
    dsarExportBulk.start,
    { selection: { filter: { email } }, params: { email, orgName: 'Alpha Events' } },
    ctx,
    ports,
  );
  expect(await runBulk(orgId, operationId)).toBe('done');
  const file = await executeQuery(dsarExportBulk.file, { operationId }, ctx, ports);
  return { operationId, file, doc: JSON.parse(file.content) as Record<string, unknown> };
}

describe('data-subject requests: find', () => {
  it('finds a buyer across contacts, orders, tickets, answers and check-ins (case-insensitive)', async () => {
    const r = await find(`  ${buyer(a).toUpperCase()} `);
    expect(r.email).toBe(buyer(a));
    expect(r.found).toBe(true);
    expect(r.summary).toMatchObject({
      contacts: 1,
      orders: 1,
      paidOrders: 1,
      tickets: 2,
      activeTickets: 2,
      answers: 1,
    });
    expect(r.summary.consents).toBeGreaterThanOrEqual(1);
    expect(r.summary.admissions).toBeGreaterThanOrEqual(1);
    expect(r.summary.holderLinks).toBe(1);
  });

  it('finds nothing for an unknown address, and never another org’s person', async () => {
    expect((await find('nobody@example.test')).found).toBe(false);
    // Org B asks about org A's buyer: nothing (RLS), while B's own buyer is found.
    expect((await find(buyer(a), b.ctx())).found).toBe(false);
    expect((await find(buyer(b), b.ctx())).found).toBe(true);
  });

  it('is for owners and admins only', async () => {
    for (const id of [managerId, a.viewerId])
      await expect(find(buyer(a), userCtx(id, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(find('not-an-email')).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('data-subject requests: access export', () => {
  it('exports everything held about the person as allowlisted JSON, and records the request', async () => {
    const { file, doc, operationId } = await exportFor(buyer(a));
    expect(file.name).toMatch(/^personal-data-\d{4}-\d{2}-\d{2}\.json$/);
    expect(file.contentType).toContain('application/json');
    expect(doc).toMatchObject({
      format: 'yayatoh.dsar/1',
      subject: { email: buyer(a) },
      controller: 'Alpha Events',
    });
    const orders = doc.orders as { buyerEmail: string; totalMinor: number; items: unknown[] }[];
    expect(orders).toHaveLength(1);
    expect(orders[0]?.buyerEmail).toBe(buyer(a));
    expect(orders[0]?.items.length).toBeGreaterThan(0);
    expect((doc.tickets as unknown[]).length).toBe(2);
    expect((doc.checkIns as unknown[]).length).toBeGreaterThanOrEqual(1);
    // Sensitive answers are decrypted for the subject, with question labels.
    const answers = doc.formAnswers as { answers: { question: string; value: unknown }[] }[];
    expect(answers[0]?.answers).toEqual(
      expect.arrayContaining([
        { question: 'Kids', value: 1 },
        { question: 'Access needs', value: 'Step-free entrance' },
      ]),
    );
    expect(Object.values(doc.events as object)).toContain(a.event.name);
    // Allowlist: no tokens, hashes, provider ids, signing material or internal contact ids.
    const text = JSON.stringify(doc);
    for (const bad of [
      'manageToken',
      'TokenHash',
      'providerPaymentId',
      'fakepi_',
      'privateKey',
      'Ciphertext',
      'feeSchedule',
      'connectedAccountId',
      'contactId',
    ])
      expect(text).not.toContain(bad);

    const history = await executeQuery(dsarHistoryQuery, {}, a.ctx(), ports);
    const req = history.find((h) => h.kind === 'access' && h.summary.orders === 1);
    expect(req?.subjectHint).toBe(maskEmail(buyer(a)));
    expect(req?.requestedBy).toBe(a.ownerId);
    // The request record never holds the address.
    const raw = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ r: string }>(sql`select row_to_json(d)::text as r from privacy.dsar_requests d`),
    );
    for (const row of raw) expect(row.r).not.toContain(buyer(a));
    // The export was audited without the address.
    const log = await executeQuery(
      auditLogQuery,
      { filter: { action: 'bulk.start' }, limit: 100 },
      a.ctx(),
      ports,
    );
    expect(
      log.entries.some((e) => e.details.action === 'privacy.dsarExport' && e.targetId === operationId),
    ).toBe(true);
    expect(JSON.stringify(log.entries)).not.toContain(buyer(a));
  });

  it('refuses managers, viewers and other orgs', async () => {
    await expect(exportFor(buyer(a), userCtx(managerId, a.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    const { operationId } = await exportFor(buyer(a));
    await expect(executeQuery(dsarExportBulk.file, { operationId }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('data-subject requests: erasure', () => {
  it('needs the email typed again, and owner/admin rights', async () => {
    await expect(
      executeCommand(eraseSubjectCommand, { email: buyer(a), confirm: 'someone@else.test' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        eraseSubjectCommand,
        { email: buyer(a), confirm: buyer(a) },
        userCtx(managerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        eraseSubjectCommand,
        { email: 'nobody@x.test', confirm: 'nobody@x.test' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('redacts the person everywhere, keeps paid orders, the ledger and tickets, and purges export files', async () => {
    const { operationId } = await exportFor(buyer(a));
    const ledger = async () =>
      withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute<{ n: number; s: string }>(
          sql`select count(*)::int as n, coalesce(sum(amount_minor), 0)::text as s from payments.postings`,
        ),
      );
    const ledgerBefore = await ledger();
    const [orderBefore] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ id: string; status: string; total_minor: string }>(
        sql`select id, status, total_minor::text from orders.orders where buyer_email = ${buyer(a)}`,
      ),
    );
    const bFind = await find(buyer(b), b.ctx());

    const r = await executeCommand(
      eraseSubjectCommand,
      { email: buyer(a), confirm: ` ${buyer(a).toUpperCase()}` },
      a.ctx(),
      ports,
    );
    expect(r.summary).toMatchObject({
      contacts: 1,
      orders: 1,
      paidOrdersKept: 1,
      tickets: 2,
      activeTicketsKept: 2,
      answers: 1,
      holderLinks: 1,
    });
    expect(r.summary.files).toBeGreaterThanOrEqual(1);

    // Nothing identifies them any more.
    expect((await find(buyer(a))).found).toBe(false);
    const leftovers = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ n: number }>(sql`
        select (select count(*) from orders.orders where buyer_email = ${buyer(a)} or buyer_name = 'Fixture Buyer')
             + (select count(*) from ticketing.tickets where lower(holder_email) = ${buyer(a)})
             + (select count(*) from crm.contacts where email_norm = ${buyer(a)})
             + (select count(*) from attendees.attendees where lower(email) = ${buyer(a)})
             + (select count(*) from ticketing.holder_links where email_norm = ${buyer(a)})
             + (select count(*) from platform.file_parts where data ilike ${`%${buyer(a)}%`}) as n`),
    );
    expect(Number(leftovers[0]?.n)).toBe(0);
    // The paid order is kept (legal hold) with its amounts; tickets stay valid; the ledger is untouched.
    const [orderAfter] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{
        status: string;
        total_minor: string;
        buyer_email: string;
        manage_token_ciphertext: string | null;
      }>(
        sql`select status, total_minor::text, buyer_email, manage_token_ciphertext from orders.orders where id = ${orderBefore?.id}`,
      ),
    );
    expect(orderAfter).toEqual({
      status: orderBefore?.status,
      total_minor: orderBefore?.total_minor,
      buyer_email: ERASED_EMAIL,
      manage_token_ciphertext: null,
    });
    const tickets = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ status: string; holder_name: string }>(
        sql`select status, holder_name from ticketing.tickets where order_id = ${orderBefore?.id}`,
      ),
    );
    expect(tickets.every((t) => t.status === 'active' && t.holder_name === 'Erased')).toBe(true);
    expect(await ledger()).toEqual(ledgerBefore);
    // Answers are gone; the access export file that named them is gone.
    const [resp] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ answers: object; s: string | null }>(
        sql`select answers, sensitive_ciphertext as s from forms.form_responses where respondent_id = ${orderBefore?.id}`,
      ),
    );
    expect(resp).toEqual({ answers: {}, s: null });
    await expect(executeQuery(dsarExportBulk.file, { operationId }, a.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });

    // Recorded and audited without the address; the chain still verifies.
    const history = await executeQuery(dsarHistoryQuery, {}, a.ctx(), ports);
    expect(history[0]).toMatchObject({
      kind: 'erasure',
      subjectHint: maskEmail(buyer(a)),
      requestedBy: a.ownerId,
    });
    const log = await executeQuery(auditLogQuery, { filter: { action: 'privacy.erase' } }, a.ctx(), ports);
    expect(log.entries[0]?.targetId).toBe(r.requestId);
    expect(JSON.stringify(log.entries)).not.toContain(buyer(a));
    expect((await withTenant(a.ctx(), verifyAuditChainTx)).verified).toBe(true);
    // Another org is untouched.
    expect((await find(buyer(b), b.ctx())).summary).toEqual(bFind.summary);
    // A second erasure finds nothing.
    await expect(
      executeCommand(eraseSubjectCommand, { email: buyer(a), confirm: buyer(a) }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('retention', () => {
  it('redacts and purges by the defaults, is idempotent, keeps paid orders, and is system-only', async () => {
    const { a: o } = await twoOrgs();
    await expect(executeCommand(retentionCommand, {}, o.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });

    const at = (iso: string) => ({ ...systemCtx(o.org.id), now: new Date(iso) });
    const r = await executeCommand(retentionCommand, {}, at('2031-06-01T00:00:00Z'), ports);
    expect(r.files).toBeGreaterThanOrEqual(1);
    expect(r.scans).toBeGreaterThanOrEqual(1);
    expect(r.attendees).toBeGreaterThanOrEqual(1);
    expect(r.ticketHolders).toBeGreaterThanOrEqual(1);
    expect(r.holderLinks).toBe(1);
    expect(r.bulkParams).toBeGreaterThanOrEqual(1);

    const rows = await withTenant(systemCtx(o.org.id), (tx) =>
      tx.execute<{
        files: number;
        scans: number;
        admissions: number;
        paid_named: number;
        people: number;
      }>(sql`
        select (select count(*)::int from platform.files) as files,
               (select count(*)::int from checkin.scans) as scans,
               (select count(*)::int from checkin.admissions) as admissions,
               (select count(*)::int from orders.orders where status = 'paid' and buyer_email <> ${ERASED_EMAIL}) as paid_named,
               (select count(*)::int from attendees.attendees where email <> ${ERASED_EMAIL}) as people`),
    );
    expect(rows[0]).toMatchObject({ files: 0, scans: 0, people: 0 });
    // Admissions (the counts) stay; paid orders keep their buyer for the 7-year payment record.
    expect(rows[0]?.admissions).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.paid_named).toBe(1);

    const again = await executeCommand(retentionCommand, {}, at('2031-06-01T00:00:00Z'), ports);
    expect(Object.values(again).every((n) => n === 0)).toBe(true);
    // The pass is audited with counts only.
    const log = await executeQuery(
      auditLogQuery,
      { filter: { action: 'privacy.retention' } },
      o.ctx(),
      ports,
    );
    expect(log.entries.length).toBe(2);
  });

  it('abandoned checkouts lose their buyer after 30 days, not before', async () => {
    const { a: o } = await twoOrgs();
    const ticketTypeId = (
      await withTenant(o.ctx(), (tx) =>
        tx.execute<{ id: string }>(
          sql`select id from ticketing.ticket_types where event_id = ${o.event.id} limit 1`,
        ),
      )
    )[0]?.id as string;
    const c = await executeCommand(
      startCheckoutCommand,
      {
        eventId: o.event.id,
        items: [{ ticketTypeId, quantity: 1 }],
        buyer: { email: 'walked-away@example.test', name: 'Walked Away' },
        marketingOptIn: false,
        answers: { kids: 0 },
      },
      createCtx({ orgId: o.org.id }),
      ports,
    );
    await withTenant(systemCtx(o.org.id), (tx) =>
      tx.execute(
        sql`update orders.orders set status = 'expired', expires_at = now() where id = ${c.order.id}`,
      ),
    );
    const at = (days: number) => ({ ...systemCtx(o.org.id), now: new Date(Date.now() + days * 86_400_000) });
    expect((await executeCommand(retentionCommand, {}, at(29), ports)).abandonedOrders).toBe(0);
    expect((await executeCommand(retentionCommand, {}, at(31), ports)).abandonedOrders).toBe(1);
    const [row] = await withTenant(o.ctx(), (tx) =>
      tx.execute<{ buyer_email: string; buyer_name: string; total_minor: string }>(
        sql`select buyer_email, buyer_name, total_minor::text from orders.orders where id = ${c.order.id}`,
      ),
    );
    expect(row).toMatchObject({
      buyer_email: ERASED_EMAIL,
      buyer_name: 'Erased',
      total_minor: String(c.order.totalMinor),
    });
  });
});
