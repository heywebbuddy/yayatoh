import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { mediaStore } from '@yayatoh/media';
import { startCheckoutCommand } from '@yayatoh/orders';
import { auditLogQuery, ERASED_EMAIL, verifyAuditChainTx } from '@yayatoh/platform';
import {
  ARCHIVE_FORMAT,
  archiveFileQuery,
  cancelRequestCommand,
  catchUpErasureHooks,
  dsarSigner,
  eraseSubjectCommand,
  exportSubjectCommand,
  findSubjectQuery,
  maskEmail,
  openRequestCommand,
  RECEIPT_FORMAT,
  requestQuery,
  requestsQuery,
  retentionCommand,
  selfArchiveFileQuery,
  selfReceiptQuery,
  submitSelfRequestCommand,
  verifyArchive,
  verifyReceipt,
} from '@yayatoh/privacy';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eraseNow, exportNow } from '../src/dsar/helpers.ts';
import { type OrgFixture, systemCtx, twoOrgs, userCtx } from '../src/index.ts';
import { ports } from '../src/ports.ts';

let a: OrgFixture;
let b: OrgFixture;
let managerId: string;
const buyer = (o: OrgFixture) => `buyer@${o.org.slug}.test`;
const tag = () => uuidv7().slice(-8);
const DAY = 86_400_000;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  managerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: managerId, role: 'manager' }, a.ctx(), ports);
});
afterAll(closePools);

const find = (email: string, ctx = a.ctx()) => executeQuery(findSubjectQuery, { email }, ctx, ports);
const open = (email: string, kind: 'access' | 'erasure', ctx = a.ctx()) =>
  executeCommand(openRequestCommand, { email, kind }, ctx, ports);

describe('data-subject requests: find (M1.14c, M6.1c)', () => {
  it('finds a buyer across every module, case-insensitively, counting records per module', async () => {
    const r = await find(`  ${buyer(a).toUpperCase()} `);
    expect(r.email).toBe(buyer(a));
    expect(r.found).toBe(true);
    expect(r.summary).toMatchObject({
      crm: expect.any(Number),
      orders: expect.any(Number),
      ticketing: expect.any(Number),
      forms: expect.any(Number),
    });
    expect(r.summary.privacy).toBeUndefined();
  });

  it('finds nothing for an unknown address, and never another org’s person', async () => {
    expect((await find(`nobody-${tag()}@example.test`)).found).toBe(false);
    expect((await find(buyer(a), b.ctx())).found).toBe(false);
    expect((await find(buyer(b), b.ctx())).found).toBe(true);
  });

  it('is for owners and admins only', async () => {
    for (const id of [managerId, a.viewerId])
      await expect(find(buyer(a), userCtx(id, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(find('not-an-email')).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('data-subject requests: the request (M6.1c)', () => {
  it('one open request per person per org, due in 30 days, the address sealed until it closes', async () => {
    const email = `ask-${tag()}@example.test`;
    const r = await open(email.toUpperCase(), 'access');
    expect(r.dueAt.getTime() - Date.now()).toBeGreaterThan(29 * DAY);
    expect(r.dueAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * DAY + 60_000);
    await expect(open(email, 'erasure')).rejects.toMatchObject({
      code: 'conflict',
      details: { requestId: r.requestId },
    });
    // Another org can open its own request for the same person.
    await expect(open(email, 'access', b.ctx())).resolves.toMatchObject({ requestId: expect.any(String) });
    const row = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ r: string }>(
        sql`select row_to_json(d)::text as r from privacy.dsar_requests d where id = ${r.requestId}`,
      ),
    );
    expect(row[0]?.r).not.toContain(email);
    const q = await executeQuery(requestQuery, { requestId: r.requestId }, a.ctx(), ports);
    expect(q.email).toBe(email);
    expect(q.request).toMatchObject({ status: 'open', source: 'staff', kind: 'access', overdue: false });
    expect(q.request.subjectHint).toBe(maskEmail(email));
    const list = await executeQuery(requestsQuery, {}, a.ctx(), ports);
    expect(list.open.map((x) => x.id)).toContain(r.requestId);
    // Org B never sees it.
    await expect(
      executeQuery(requestQuery, { requestId: r.requestId }, b.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await executeQuery(requestsQuery, {}, b.ctx(), ports)).open.map((x) => x.id)).not.toContain(
      r.requestId,
    );
  });

  it('is overdue after 30 days', async () => {
    const r = await open(`late-${tag()}@example.test`, 'access');
    const later = { ...a.ctx(), now: new Date(Date.now() + 31 * DAY) };
    const q = await executeQuery(requestQuery, { requestId: r.requestId }, later, ports);
    expect(q.request.overdue).toBe(true);
  });

  it('self-service requests come from the platform (verified address) and repeat to the open one', async () => {
    const email = `self-${tag()}@example.test`;
    await expect(
      executeCommand(submitSelfRequestCommand, { email, kind: 'erasure' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const first = await executeCommand(
      submitSelfRequestCommand,
      { email, kind: 'erasure' },
      systemCtx(a.org.id),
      ports,
    );
    expect(first.existing).toBe(false);
    const again = await executeCommand(
      submitSelfRequestCommand,
      { email: email.toUpperCase(), kind: 'access' },
      systemCtx(a.org.id),
      ports,
    );
    expect(again).toMatchObject({ requestId: first.requestId, existing: true });
    const q = await executeQuery(requestQuery, { requestId: first.requestId }, a.ctx(), ports);
    expect(q.request).toMatchObject({ source: 'self', verifiedAt: expect.any(Date) });
  });

  it('managers and viewers cannot open, read, fulfil or withdraw requests', async () => {
    const r = await open(`perm-${tag()}@example.test`, 'erasure');
    for (const id of [managerId, a.viewerId]) {
      const ctx = userCtx(id, a.org.id);
      await expect(open(`x-${tag()}@example.test`, 'access', ctx)).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(executeQuery(requestQuery, { requestId: r.requestId }, ctx, ports)).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(
        executeCommand(eraseSubjectCommand, { requestId: r.requestId, confirm: 'x@y.test' }, ctx, ports),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        executeCommand(cancelRequestCommand, { requestId: r.requestId, reason: 'nope' }, ctx, ports),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('can be withdrawn with a reason; the sealed address is cleared', async () => {
    const email = `withdraw-${tag()}@example.test`;
    const r = await open(email, 'erasure');
    await expect(
      executeCommand(cancelRequestCommand, { requestId: r.requestId, reason: '' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await executeCommand(
      cancelRequestCommand,
      { requestId: r.requestId, reason: 'Withdrawn by phone' },
      a.ctx(),
      ports,
    );
    const q = await executeQuery(requestQuery, { requestId: r.requestId }, a.ctx(), ports);
    expect(q).toMatchObject({
      email: null,
      cancelReason: 'Withdrawn by phone',
      request: { status: 'cancelled' },
    });
    await expect(
      executeCommand(eraseSubjectCommand, { requestId: r.requestId, confirm: email }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    // A new request can be opened now.
    await expect(open(email, 'access')).resolves.toBeTruthy();
  });
});

describe('data-subject requests: access archive (M6.1c)', () => {
  it('is one signed ZIP with a JSON file per module and a manifest; allowlisted; recorded and audited', async () => {
    const { requestId, file, entries, modules, result } = await exportNow(buyer(a), a.ctx());
    expect(file.name).toMatch(/^personal-data-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(verifyArchive(file.bytes, dsarSigner().publicKeyPem)).toEqual([]);
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));
    expect(manifest).toMatchObject({ format: ARCHIVE_FORMAT, requestId, subject: { email: buyer(a) } });
    expect(Object.keys(modules)).toEqual(expect.arrayContaining(['crm', 'orders', 'ticketing', 'forms']));
    const orders = (modules.orders as { orders: { buyerEmail: string; items: unknown[] }[] }).orders;
    expect(orders).toHaveLength(1);
    expect(orders[0]?.buyerEmail).toBe(buyer(a));
    expect(result.summary.orders).toBeGreaterThanOrEqual(1);
    // A changed file fails the check.
    const tampered = new Uint8Array(file.bytes);
    const at = Buffer.from(tampered).indexOf(Buffer.from('"module"'));
    if (at > 0) {
      tampered[at + 2] = 'x'.charCodeAt(0);
      expect(verifyArchive(tampered).length).toBeGreaterThan(0);
    }
    // Allowlist: no tokens, hashes, provider ids, signing material or internal ids.
    const text = [...entries]
      .filter(([p]) => p.endsWith('.json'))
      .map(([, b]) => new TextDecoder().decode(b))
      .join('\n');
    for (const bad of [
      'manageToken',
      'TokenHash',
      'tokenHash',
      'providerPaymentId',
      'fakepi_',
      'privateKey',
      'Ciphertext',
      'ciphertext',
      'feeSchedule',
      'connectedAccountId',
      'contactId',
    ])
      expect(text).not.toContain(bad);
    // Closed, with the archive downloadable for 7 days; the address is gone from the record.
    const q = await executeQuery(requestQuery, { requestId }, a.ctx(), ports);
    expect(q.request).toMatchObject({ status: 'completed', archiveUntil: expect.any(Date) });
    expect(q.email).toBeNull();
    const log = await executeQuery(auditLogQuery, { filter: { action: 'privacy.export' } }, a.ctx(), ports);
    expect(log.entries.some((e) => e.targetId === requestId)).toBe(true);
    expect(JSON.stringify(log.entries)).not.toContain(buyer(a));
  });

  it('only for open access requests; other orgs, managers and the self link of a staff request get nothing', async () => {
    const erasure = await open(`notaccess-${tag()}@example.test`, 'erasure');
    await expect(
      executeCommand(exportSubjectCommand, { requestId: erasure.requestId }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    const { requestId } = await exportNow(`imported-${a.org.slug}@example.test`, a.ctx());
    await expect(executeCommand(exportSubjectCommand, { requestId }, a.ctx(), ports)).rejects.toMatchObject({
      code: 'invalid_state',
    });
    await expect(executeQuery(archiveFileQuery, { requestId }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeQuery(archiveFileQuery, { requestId }, userCtx(managerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeQuery(selfArchiveFileQuery, { requestId }, systemCtx(a.org.id), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a self-service request’s archive is downloadable from the link, then expires', async () => {
    const email = `selfcopy-${tag()}@example.test`;
    const s = await executeCommand(
      submitSelfRequestCommand,
      { email, kind: 'access' },
      systemCtx(a.org.id),
      ports,
    );
    await executeCommand(exportSubjectCommand, { requestId: s.requestId }, a.ctx(), ports);
    const f = await executeQuery(
      selfArchiveFileQuery,
      { requestId: s.requestId },
      systemCtx(a.org.id),
      ports,
    );
    expect(verifyArchive(f.bytes)).toEqual([]);
    const later = { ...systemCtx(a.org.id), now: new Date(Date.now() + 8 * DAY) };
    await expect(
      executeQuery(selfArchiveFileQuery, { requestId: s.requestId }, later, ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('data-subject requests: erasure (M6.1c)', () => {
  it('needs the email typed again; nothing changes on a mismatch', async () => {
    const r = await open(`confirm-${tag()}@example.test`, 'erasure');
    await expect(
      executeCommand(
        eraseSubjectCommand,
        { requestId: r.requestId, confirm: 'someone@else.test' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'confirm' } });
    const q = await executeQuery(requestQuery, { requestId: r.requestId }, a.ctx(), ports);
    expect(q.request.status).toBe('open');
  });

  it('erases the person everywhere, keeps paid orders and the ledger under a legal hold, and signs the receipt', async () => {
    const { requestId: earlier } = await exportNow(buyer(a), a.ctx());
    const [archiveRow] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ k: string }>(sql`select export_key as k from privacy.dsar_requests where id = ${earlier}`),
    );
    expect(await mediaStore().get(a.org.id, archiveRow?.k as string)).not.toBeNull();
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

    const r = await eraseNow(buyer(a), a.ctx());
    expect(r.receipt).toMatchObject({
      format: RECEIPT_FORMAT,
      org: { id: a.org.id },
      subject: { hint: maskEmail(buyer(a)) },
      suppressed: true,
      connectors: [],
    });
    expect(r.receipt.subject.ref).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r.receipt)).not.toContain(buyer(a));
    expect(verifyReceipt(r.receipt, r.signature, dsarSigner().publicKeyPem)).toBe(true);
    expect(
      verifyReceipt({ ...r.receipt, files: r.receipt.files + 1 }, r.signature, dsarSigner().publicKeyPem),
    ).toBe(false);
    const tables = r.receipt.erased.map((e) => e.table);
    expect(tables).toEqual(
      expect.arrayContaining(['crm.contacts', 'ticketing.tickets', 'attendees.attendees']),
    );
    // The paid order is listed as kept, with the basis and the end of the hold.
    expect(r.receipt.held).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'orders.orders',
          id: orderBefore?.id,
          basis: 'tax_accounting',
          until: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      ]),
    );
    expect(r.files).toBeGreaterThanOrEqual(1);

    // Nothing identifies them any more.
    expect((await find(buyer(a))).found).toBe(false);
    const leftovers = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ n: number }>(sql`
        select (select count(*) from orders.orders where buyer_email = ${buyer(a)} or buyer_name = 'Fixture Buyer')
             + (select count(*) from ticketing.tickets where lower(holder_email) = ${buyer(a)})
             + (select count(*) from crm.contacts where email_norm = ${buyer(a)})
             + (select count(*) from attendees.attendees where lower(email) = ${buyer(a)})
             + (select count(*) from ticketing.holder_links where email_norm = ${buyer(a)})
             + (select count(*) from platform.file_parts where data ilike ${`%${buyer(a)}%`})
             + (select count(*) from platform.domain_events where payload::text ilike ${`%${buyer(a)}%`}) as n`),
    );
    expect(Number(leftovers[0]?.n)).toBe(0);
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
    const [resp] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ answers: object; s: string | null }>(
        sql`select answers, sensitive_ciphertext as s from forms.form_responses where respondent_id = ${orderBefore?.id}`,
      ),
    );
    expect(resp).toEqual({ answers: {}, s: null });

    // The earlier archive goes after commit (media subscriber), and the connector hooks run (none yet).
    const { catchUpErasedMedia } = await import('@yayatoh/media');
    await catchUpErasedMedia(a.org.id);
    await catchUpErasureHooks(a.org.id);
    expect(await mediaStore().get(a.org.id, archiveRow?.k as string)).toBeNull();
    await expect(
      executeQuery(archiveFileQuery, { requestId: earlier }, a.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });

    // Recorded and audited without the address; the chain still verifies.
    const q = await executeQuery(requestQuery, { requestId: r.requestId }, a.ctx(), ports);
    expect(q).toMatchObject({ request: { status: 'completed', hasReceipt: true }, email: null });
    expect(q.receipt).toEqual(r.receipt);
    const log = await executeQuery(auditLogQuery, { filter: { action: 'privacy.erase' } }, a.ctx(), ports);
    expect(log.entries[0]?.targetId).toBe(r.requestId);
    expect(JSON.stringify(log.entries)).not.toContain(buyer(a));
    expect((await withTenant(a.ctx(), verifyAuditChainTx)).verified).toBe(true);
    const raw =
      await adminClient()`select row_to_json(d)::text as r from privacy.dsar_requests d where org_id = ${a.org.id}`;
    for (const row of raw) expect(String(row.r)).not.toContain(buyer(a));
    // Another org is untouched.
    expect((await find(buyer(b), b.ctx())).summary).toEqual(bFind.summary);
    // The self receipt link is only for self-service requests.
    await expect(
      executeQuery(selfReceiptQuery, { requestId: r.requestId }, systemCtx(a.org.id), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a self-service erasure’s receipt is readable from the link, and verifies', async () => {
    const email = `selfgone-${tag()}@example.test`;
    const s = await executeCommand(
      submitSelfRequestCommand,
      { email, kind: 'erasure' },
      systemCtx(a.org.id),
      ports,
    );
    await executeCommand(eraseSubjectCommand, { requestId: s.requestId, confirm: email }, a.ctx(), ports);
    const r = await executeQuery(selfReceiptQuery, { requestId: s.requestId }, systemCtx(a.org.id), ports);
    expect(r.receipt.source).toBe('self');
    expect(verifyReceipt(r.receipt, r.signature, dsarSigner().publicKeyPem)).toBe(true);
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
    // The fixture's access archive (M6.1c) is past its 7 days.
    expect(r.dsarArchives).toBe(1);

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
          sql`select id from ticketing.ticket_types where event_id = ${o.event.id} and managed_by is null order by created_at limit 1`,
        ),
      )
    )[0]?.id as string;
    // The fixture's own lapsed orders (M4.8a: a gift order that expired unpaid) count too.
    const [fixture] = await withTenant(o.ctx(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from orders.orders
          where status in ('expired', 'cancelled') and buyer_email <> ${ERASED_EMAIL}`,
      ),
    );
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
    expect((await executeCommand(retentionCommand, {}, at(31), ports)).abandonedOrders).toBe(
      1 + (fixture?.n ?? 0),
    );
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
