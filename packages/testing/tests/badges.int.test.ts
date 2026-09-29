import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  assignTemplateCommand,
  type BatchDto,
  badgesSetupQuery,
  batchFileByLink,
  batchLinkQuery,
  CHUNK_SIZE,
  cancelBatchCommand,
  createTemplateCommand,
  defaultDesign,
  deleteTemplateCommand,
  listBatchesQuery,
  runBadgeBatch,
  samplePreviewQuery,
  saveTemplateCommand,
  setDefaultTemplateCommand,
  singleBadgeQuery,
  startBatchCommand,
  storeBatchChunkCommand,
  type TemplateDto,
} from '@yayatoh/badges';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto, transitionEventCommand } from '@yayatoh/events';
import { publishFormCommand } from '@yayatoh/forms';
import { type Ctx, createCtx, DomainError, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  recordBoxOfficeSaleCommand,
  startCheckoutCommand,
} from '@yayatoh/orders';
import { gotenbergRenderer, type PdfRenderer, qrPath } from '@yayatoh/pdf';
import { verifyTicketCode } from '@yayatoh/ticket-crypto';
import { badgeTicketsTx, createTicketTypeCommand, publicKeysTx } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

const GOTENBERG = process.env.GOTENBERG_URL ?? 'http://localhost:3300';
const gotenberg = gotenbergRenderer({ url: GOTENBERG, timeoutMs: 60_000 });

let a: OrgFixture;
let b: OrgFixture;
let ev: EventDto;
let vip: string;
let ga: string;
const viewer = () => userCtx(a.viewerId, a.org.id);

/** A recording renderer: keeps every HTML it was given, returns a tiny PDF. */
function fakeRenderer(opts: { failOnCall?: number } = {}) {
  const htmls: string[] = [];
  let calls = 0;
  const renderer: PdfRenderer = {
    async render({ html }) {
      calls += 1;
      if (opts.failOnCall === calls) throw new Error('gotenberg: 503 cold start');
      htmls.push(html);
      return new TextEncoder().encode(`%PDF-part-${htmls.length}`);
    },
    async merge(pdfs) {
      return new TextEncoder().encode(`%PDF-merged-${pdfs.length}`);
    },
  };
  return { renderer, htmls };
}

async function buy(
  eventId: string,
  ticketTypeId: string,
  name: string,
  answers: Record<string, unknown>,
  n = 1,
) {
  const c = createCtx({ orgId: a.org.id });
  const tag = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const checkout = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId, quantity: n }],
      buyer: { email: `b${tag}@badges.test`, name },
      answers,
    },
    c,
    ports,
  );
  // Free tickets complete at once; paid ones go through the fake provider.
  if (checkout.order.status === 'paid') return;
  await executeCommand(
    attachPaymentCommand,
    { orderId: checkout.order.id, provider: 'fake', providerPaymentId: `fakepi_${tag}` },
    c,
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_${tag}`,
      type: 'payment.succeeded',
      providerPaymentId: `fakepi_${tag}`,
      amountMinor: checkout.order.totalMinor,
      currency: checkout.order.currency,
      orgId: a.org.id,
      orderId: checkout.order.id,
    },
    systemCtx(a.org.id),
    ports,
  );
}

async function newEvent(name: string) {
  const e = await executeCommand(
    createEventCommand,
    {
      name,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: '2030-06-01T14:00:00Z',
      endsAt: '2030-06-02T23:00:00Z',
    },
    a.ctx(),
    ports,
  );
  return e;
}

const expectRefused = async (p: Promise<unknown>, code = 'forbidden') => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  return err as DomainError;
};

const run = (batchId: string, renderer: PdfRenderer, opts = {}) =>
  runBadgeBatch({ ports, renderer }, a.org.id, batchId, opts);

const start = (ctx: Ctx, input: Record<string, unknown>) =>
  executeCommand(
    startBatchCommand,
    { eventId: ev.id, requestKey: `req-${Date.now()}-${Math.random()}`, sort: 'last_name', ...input },
    ctx,
    ports,
  );

let tpl: TemplateDto;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  ev = await newEvent(`Badges Summit ${a.org.slug}`);
  vip = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId: ev.id, name: 'VIP', priceMinor: 0, quantityTotal: 500 },
      a.ctx(),
      ports,
    )
  ).id;
  ga = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId: ev.id, name: 'General Admission', priceMinor: 0, quantityTotal: 500 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(
    publishFormCommand,
    {
      kind: 'checkout_questions',
      subjectType: 'event',
      subjectId: ev.id,
      definition: {
        fields: [
          { key: 'company', type: 'short_text', label: 'Company' },
          { key: 'job_title', type: 'short_text', label: 'Job title' },
          { key: 'passport', type: 'short_text', label: 'Passport number', sensitive: true },
          { key: 'meal', type: 'select', label: 'Meal', options: [{ value: 'veg', label: 'Vegetarian' }] },
        ],
      },
    },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
  await buy(ev.id, vip, 'Zoe Adams', {
    company: 'Initech',
    job_title: 'CTO',
    passport: 'P-SECRET-1',
    meal: 'veg',
  });
  await buy(ev.id, ga, 'Bob Baker', { company: 'Acme', job_title: 'Engineer', passport: 'P-SECRET-2' });
  await buy(ev.id, ga, 'Ada Lovelace', { company: 'Initech', job_title: 'Countess' });
  await buy(ev.id, vip, 'Carl Young', { job_title: 'Freelancer' });
  tpl = await executeCommand(
    createTemplateCommand,
    { eventId: ev.id, name: 'Attendee', size: 'fold_4x3' },
    a.ctx(),
    ports,
  );
}, 120_000);

afterAll(async () => {
  await closePools();
});

describe('templates and assignments', () => {
  it('the first template is the default and starts from the size preset', async () => {
    expect(tpl).toMatchObject({ isDefault: true, version: 1, size: 'fold_4x3' });
    expect(tpl.design).toEqual(defaultDesign('fold_4x3'));
  });

  it('refuses a duplicate name (case-insensitive) and a stale save', async () => {
    await expectRefused(
      executeCommand(
        createTemplateCommand,
        { eventId: ev.id, name: 'ATTENDEE', size: 'cr80' },
        a.ctx(),
        ports,
      ),
      'conflict',
    );
    const saved = await executeCommand(
      saveTemplateCommand,
      { eventId: ev.id, templateId: tpl.id, name: 'Attendee', design: tpl.design, baseVersion: 1 },
      a.ctx(),
      ports,
    );
    expect(saved.version).toBe(2);
    const e = await expectRefused(
      executeCommand(
        saveTemplateCommand,
        { eventId: ev.id, templateId: tpl.id, name: 'Attendee', design: tpl.design, baseVersion: 1 },
        a.ctx(),
        ports,
      ),
      'conflict',
    );
    expect(e.details).toMatchObject({ reason: 'stale_version' });
    tpl = saved;
  });

  it('maps only non-sensitive free-text questions onto badges, and ribbons only for its ticket types', async () => {
    const setup = await executeQuery(badgesSetupQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(setup.questions).toEqual([
      { key: 'company', label: 'Company' },
      { key: 'job_title', label: 'Job title' },
    ]);
    const save = (design: TemplateDto['design']) =>
      executeCommand(
        saveTemplateCommand,
        { eventId: ev.id, templateId: tpl.id, name: 'Attendee', design, baseVersion: tpl.version },
        a.ctx(),
        ports,
      );
    for (const key of ['passport', 'meal', 'nope']) {
      const e = await expectRefused(
        save({ ...tpl.design, sources: { company: key, jobTitle: null } }),
        'validation_failed',
      );
      expect(e.details).toMatchObject({ reason: 'question_not_allowed' });
    }
    await expectRefused(
      save({ ...tpl.design, ribbons: { [b.event.id]: { label: 'X', color: 'ink' } } }),
      'validation_failed',
    );
    tpl = await save({
      ...tpl.design,
      sources: { company: 'company', jobTitle: 'job_title' },
      ribbons: { [vip]: { label: 'VIP', color: 'pink' } },
    });
    expect(tpl.version).toBe(3);
  });

  it('one template per ticket type; unassigning returns the type to the default', async () => {
    const speaker = await executeCommand(
      createTemplateCommand,
      { eventId: ev.id, name: 'Speaker card', size: 'cr80', copyFromId: tpl.id },
      a.ctx(),
      ports,
    );
    expect(speaker.isDefault).toBe(false);
    expect(speaker.design.back).toEqual([]);
    // Copying keeps the answer mapping and ribbons.
    expect(speaker.design.sources).toEqual(tpl.design.sources);
    await executeCommand(
      assignTemplateCommand,
      { eventId: ev.id, ticketTypeId: vip, templateId: speaker.id },
      a.ctx(),
      ports,
    );
    await executeCommand(
      assignTemplateCommand,
      { eventId: ev.id, ticketTypeId: vip, templateId: tpl.id },
      a.ctx(),
      ports,
    );
    let setup = await executeQuery(badgesSetupQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(setup.assignments).toEqual([{ ticketTypeId: vip, templateId: tpl.id }]);
    await executeCommand(
      assignTemplateCommand,
      { eventId: ev.id, ticketTypeId: vip, templateId: null },
      a.ctx(),
      ports,
    );
    setup = await executeQuery(badgesSetupQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(setup.assignments).toEqual([]);
    // Deleting the default promotes the oldest remaining template.
    await executeCommand(
      setDefaultTemplateCommand,
      { eventId: ev.id, templateId: speaker.id },
      a.ctx(),
      ports,
    );
    await executeCommand(deleteTemplateCommand, { eventId: ev.id, templateId: speaker.id }, a.ctx(), ports);
    setup = await executeQuery(badgesSetupQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(setup.templates.map((t) => [t.name, t.isDefault])).toEqual([['Attendee', true]]);
    await executeCommand(
      assignTemplateCommand,
      { eventId: ev.id, ticketTypeId: ga, templateId: tpl.id },
      a.ctx(),
      ports,
    );
  });

  it('refuses a ticket type of another event', async () => {
    const other = await newEvent(`Other ${Date.now()}`);
    await expectRefused(
      executeCommand(
        assignTemplateCommand,
        { eventId: other.id, ticketTypeId: vip, templateId: null },
        a.ctx(),
        ports,
      ),
      'not_found',
    );
  });
});

describe('permissions', () => {
  it('a viewer can preview but every write is refused', async () => {
    const setup = await executeQuery(badgesSetupQuery, { eventId: ev.id }, viewer(), ports);
    expect(setup.templates.length).toBe(1);
    const preview = await executeQuery(
      samplePreviewQuery,
      { eventId: ev.id, templateId: tpl.id, lang: 'ar' },
      viewer(),
      ports,
    );
    expect(preview.html).toContain('dir="rtl"');
    await expect(executeQuery(listBatchesQuery, { eventId: ev.id }, viewer(), ports)).resolves.toBeInstanceOf(
      Array,
    );
    const writes: (() => Promise<unknown>)[] = [
      () =>
        executeCommand(createTemplateCommand, { eventId: ev.id, name: 'V', size: 'cr80' }, viewer(), ports),
      () =>
        executeCommand(
          saveTemplateCommand,
          { eventId: ev.id, templateId: tpl.id, name: 'V', design: tpl.design, baseVersion: tpl.version },
          viewer(),
          ports,
        ),
      () =>
        executeCommand(setDefaultTemplateCommand, { eventId: ev.id, templateId: tpl.id }, viewer(), ports),
      () => executeCommand(deleteTemplateCommand, { eventId: ev.id, templateId: tpl.id }, viewer(), ports),
      () =>
        executeCommand(
          assignTemplateCommand,
          { eventId: ev.id, ticketTypeId: ga, templateId: null },
          viewer(),
          ports,
        ),
      () => start(viewer(), {}),
      () => executeCommand(cancelBatchCommand, { eventId: ev.id, batchId: tpl.id }, viewer(), ports),
      () => executeQuery(batchLinkQuery, { eventId: ev.id, batchId: tpl.id }, viewer(), ports),
      () => executeQuery(singleBadgeQuery, { eventId: ev.id, ticketId: tpl.id }, viewer(), ports),
    ];
    for (const w of writes) await expectRefused(w());
  });

  it('starting a batch needs a recent step-up (names leave in bulk)', async () => {
    await expectRefused(start(a.ctx({ stepUpAt: null }), {}), 'step_up_required');
  });
});

describe('batch PDF', () => {
  it('sorts by company (no company last) and prints only allowlisted fields', async () => {
    const batch = await start(a.ctx(), { sort: 'company' });
    expect(batch).toMatchObject({ status: 'queued', total: 4, processed: 0, skipped: 0 });
    const { renderer, htmls } = fakeRenderer();
    expect(await run(batch.id, renderer)).toEqual({ status: 'done', chunks: 1 });
    const html = htmls[0] ?? '';
    const order = ['Bob', 'Zoe', 'Ada', 'Carl'].map((n) => html.indexOf(`>${n}<`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(html).toContain('Initech');
    expect(html).toContain('Countess');
    expect(html).not.toMatch(/P-SECRET|Vegetarian|veg<|@badges\.test/);
    // The VIP ribbon shows on the two VIP badges only (GA has no ribbon: no empty bar).
    expect(html.match(/class="el ribbon"[^>]*><span dir="auto">VIP</g)?.length).toBe(2);
    expect(html.match(/class="el ribbon"/g)?.length).toBe(2);
  });

  it('sorts A–Z by last name, optionally filtered by ticket type', async () => {
    const { renderer, htmls } = fakeRenderer();
    const all = await start(a.ctx(), { sort: 'last_name' });
    await run(all.id, renderer);
    const html = htmls[0] ?? '';
    const order = ['Zoe', 'Bob', 'Ada', 'Carl'].map((n) => html.indexOf(`>${n}<`));
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    const vipOnly = await start(a.ctx(), { sort: 'last_name', ticketTypeIds: [vip] });
    expect(vipOnly.total).toBe(2);
  });

  it('is idempotent per request key', async () => {
    const key = `same-${Date.now()}`;
    const one = await start(a.ctx(), { requestKey: key });
    const two = await start(a.ctx(), { requestKey: key });
    expect(two.id).toBe(one.id);
    const listed = await executeQuery(listBatchesQuery, { eventId: ev.id, limit: 50 }, a.ctx(), ports);
    expect(listed.filter((x) => x.id === one.id)).toHaveLength(1);
  });

  it('cancel stops a batch between chunks and drops its parts', async () => {
    const batch = await start(a.ctx(), {});
    const { renderer } = fakeRenderer();
    // Queued → running, but no chunk rendered yet.
    await run(batch.id, renderer, { maxChunks: 0 });
    const c = await executeCommand(cancelBatchCommand, { eventId: ev.id, batchId: batch.id }, a.ctx(), ports);
    expect(c.status).toBe('cancelled');
    expect(await run(batch.id, renderer)).toEqual({ status: 'cancelled', chunks: 0 });
    await expectRefused(
      executeCommand(cancelBatchCommand, { eventId: ev.id, batchId: batch.id }, a.ctx(), ports),
      'invalid_state',
    );
    await expectRefused(
      executeQuery(batchLinkQuery, { eventId: ev.id, batchId: batch.id }, a.ctx(), ports),
      'invalid_state',
    );
  });

  it('downloads through a signed, expiring link only', async () => {
    const batch = await start(a.ctx(), {});
    const { renderer } = fakeRenderer();
    await run(batch.id, renderer);
    const link = await executeQuery(batchLinkQuery, { eventId: ev.id, batchId: batch.id }, a.ctx(), ports);
    expect(link.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);
    const file = await batchFileByLink(link.token);
    expect(new TextDecoder().decode(file?.bytes)).toBe('%PDF-part-1');
    expect(await batchFileByLink(`${link.token.slice(0, -2)}xx`)).toBeNull();
    expect(await batchFileByLink(link.token, { now: new Date(Date.now() + 16 * 60_000) })).toBeNull();
    // The org inside the token is signed: swapping it breaks the link.
    expect(await batchFileByLink(link.token.replace(a.org.id, b.org.id))).toBeNull();
    // Another org cannot mint a link for it (RLS: not found).
    await expectRefused(
      executeQuery(batchLinkQuery, { eventId: ev.id, batchId: batch.id }, b.ctx(), ports),
      'not_found',
    );
  });

  it('the badge QR is the ticket code, unchanged, and verifies with the event public key', async () => {
    const entry = createRequire(import.meta.url).resolve('zxing-wasm/reader');
    const wasm = readFileSync(join(dirname(entry), '..', '..', 'reader', 'zxing_reader.wasm'));
    await prepareZXingModule({
      overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) },
      fireImmediately: true,
    });
    const tickets = await withTenant(a.ctx(), (tx) => badgeTicketsTx(tx, { eventId: ev.id }));
    const t = tickets[0];
    if (!t) throw new Error('no tickets');
    const one = await executeQuery(singleBadgeQuery, { eventId: ev.id, ticketId: t.id }, a.ctx(), ports);
    const d = /<svg class="qr"[^>]*>.*?<path d="([^"]+)"/s.exec(one.html)?.[1] ?? '';
    expect(d).toBe(qrPath(t.code).d);
    // Rasterise the printed path and read it back as the Scan PWA's fallback decoder does.
    const size = qrPath(t.code).size;
    const scale = 4;
    const width = size * scale;
    const data = new Uint8ClampedArray(width * width * 4).fill(255);
    for (const m of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g))
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = ((Number(m[2]) * scale + dy) * width + Number(m[1]) * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
    const [hit] = await readBarcodes({ data, width, height: width, colorSpace: 'srgb' } as ImageData, {
      formats: ['QRCode'],
      maxNumberOfSymbols: 1,
    });
    expect(hit?.text).toBe(t.code);
    const keys = await withTenant(a.ctx(), (tx) => publicKeysTx(tx));
    const v = await verifyTicketCode(hit?.text ?? '', keys);
    expect(v).toMatchObject({ ok: true, ticketId: t.id });
  });

  it('a voided ticket is left out of its chunk', async () => {
    const batch = await start(a.ctx(), {});
    const [first] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ id: string }>(
        sql`select unnest(ticket_ids) as id from badges.batches where id = ${batch.id} limit 1`,
      ),
    );
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(
        sql`update ticketing.tickets set status = 'void', void_reason = 'refunded' where id = ${first?.id}`,
      ),
    );
    const { renderer, htmls } = fakeRenderer();
    expect((await run(batch.id, renderer)).status).toBe('done');
    expect(htmls[0]?.match(/<section class="badge"/g)).toHaveLength(3);
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(
        sql`update ticketing.tickets set status = 'active', void_reason = null where id = ${first?.id}`,
      ),
    );
  });
});

describe('tenant isolation', () => {
  it('another org sees none of these templates or batches and cannot start one on this event', async () => {
    await expectRefused(executeQuery(badgesSetupQuery, { eventId: ev.id }, b.ctx(), ports), 'not_found');
    expect(await executeQuery(listBatchesQuery, { eventId: ev.id }, b.ctx(), ports)).toEqual([]);
    await expectRefused(start(b.ctx(), {}), 'not_found');
    const rows = await withTenant(b.ctx(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from badges.templates where event_id = ${ev.id}`,
      ),
    );
    expect(rows[0]?.n).toBe(0);
  });
});

describe('the batch job (Gotenberg)', { timeout: 300_000 }, () => {
  let big: EventDto;
  let bigBatch: BatchDto;

  beforeAll(async () => {
    big = await newEvent(`Badges 1000 ${Date.now()}`);
    await executeCommand(transitionEventCommand, { eventId: big.id, transition: 'publish' }, a.ctx(), ports);
    const types = [];
    for (const name of ['Delegate', 'Speaker', 'Exhibitor', 'Staff'])
      types.push(
        await executeCommand(
          createTicketTypeCommand,
          { eventId: big.id, name, priceMinor: 0, quantityTotal: 1000, maxPerOrder: 100 },
          a.ctx(),
          ports,
        ),
      );
    // 1,000 tickets: box-office sales of 100 (the command's cap per line).
    for (let i = 0; i < 10; i++)
      await executeCommand(
        recordBoxOfficeSaleCommand,
        {
          eventId: big.id,
          items: [{ ticketTypeId: (types[i % 4] as { id: string }).id, quantity: 100 }],
          buyer: { email: `bulk${i}@badges.test`, name: `Buyer ${i}` },
          method: 'cash',
        },
        a.ctx(),
        ports,
      );
    // Distinct holders (Latin and Arabic names) so sorting and fitting are exercised.
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`update ticketing.tickets set holder_name = case when serial % 5 = 0
        then 'ليلى ' || 'الفارسي' || serial else 'Person' || serial || ' Surname' || (1000 - serial) end
        where event_id = ${big.id}`),
    );
    const t = await executeCommand(
      createTemplateCommand,
      { eventId: big.id, name: 'Big', size: 'fold_4x3' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      saveTemplateCommand,
      {
        eventId: big.id,
        templateId: t.id,
        name: 'Big',
        design: {
          ...t.design,
          ribbons: Object.fromEntries(types.map((x) => [x.id, { label: x.name, color: 'ink' }])),
        },
        baseVersion: 1,
      },
      a.ctx(),
      ports,
    );
    bigBatch = await executeCommand(
      startBatchCommand,
      { eventId: big.id, requestKey: `big-${Date.now()}`, sort: 'last_name' },
      a.ctx(),
      ports,
    );
  }, 300_000);

  it('renders 1,000 badges in one job in under 2 minutes', async () => {
    expect(bigBatch.total).toBe(1000);
    const t0 = Date.now();
    const r = await runBadgeBatch({ ports, renderer: gotenberg }, a.org.id, bigBatch.id, {
      budgetMs: 120_000,
    });
    const ms = Date.now() - t0;
    expect(r).toEqual({ status: 'done', chunks: 1000 / CHUNK_SIZE });
    expect(ms).toBeLessThan(120_000);
    const link = await executeQuery(
      batchLinkQuery,
      { eventId: big.id, batchId: bigBatch.id },
      a.ctx(),
      ports,
    );
    const file = await batchFileByLink(link.token);
    const pdf = await getDocument({ data: new Uint8Array(file?.bytes ?? []) }).promise;
    expect(pdf.numPages).toBe(1000);
    const page = await pdf.getPage(1);
    const [, , w, h] = page.view;
    // A 4×3 fold-over sheet: 4 × 6 in = 288 × 432 pt.
    expect([Math.round(w ?? 0), Math.round(h ?? 0)]).toEqual([288, 432]);
    console.info(JSON.stringify({ test: 'badges-1000', ms, bytes: file?.bytes.byteLength }));
  });

  it('is idempotent under retries: a failed chunk re-runs, nothing is counted twice', async () => {
    const batch = await executeCommand(
      startBatchCommand,
      { eventId: big.id, requestKey: `retry-${Date.now()}`, sort: 'company', ticketTypeIds: [] },
      a.ctx(),
      ports,
    );
    // The first attempt dies on its third render call (a cold Gotenberg), like a crashed job.
    let calls = 0;
    const flaky: PdfRenderer = {
      render: async (input) => {
        calls += 1;
        if (calls === 3) throw new Error('gotenberg: 503');
        return gotenberg.render(input);
      },
      merge: (pdfs) => gotenberg.merge?.(pdfs) ?? Promise.reject(new Error('no merge')),
    };
    await expect(
      runBadgeBatch({ ports, renderer: flaky }, a.org.id, batch.id, { budgetMs: 120_000 }),
    ).rejects.toThrow(/503/);
    let [row] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ processed: number; parts: number }>(
        sql`select processed, (select count(*)::int from badges.batch_parts p where p.batch_id = b.id) as parts
            from badges.batches b where id = ${batch.id}`,
      ),
    );
    expect(row).toEqual({ processed: 200, parts: 2 });
    // A duplicate delivery of an already stored chunk is ignored.
    const dup = await executeCommand(
      storeBatchChunkCommand,
      { batchId: batch.id, seq: 0, count: 100, pdf: new Uint8Array([1]) },
      createCtx({ orgId: a.org.id, actor: { type: 'system', name: 'test' } }),
      ports,
    );
    expect(dup).toEqual({ processed: 200, stored: false });
    // The retried job (and a second runner at the same time) finish it exactly once.
    const [r1, r2] = await Promise.all([
      runBadgeBatch({ ports, renderer: gotenberg }, a.org.id, batch.id, { budgetMs: 120_000 }),
      runBadgeBatch({ ports, renderer: gotenberg }, a.org.id, batch.id, { budgetMs: 120_000 }),
    ]);
    expect([r1.status, r2.status]).toEqual(['done', 'done']);
    [row] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ processed: number; parts: number }>(
        sql`select processed, (select count(*)::int from badges.batch_parts p where p.batch_id = b.id) as parts
            from badges.batches b where id = ${batch.id}`,
      ),
    );
    expect(row).toEqual({ processed: 1000, parts: 0 });
    const link = await executeQuery(batchLinkQuery, { eventId: big.id, batchId: batch.id }, a.ctx(), ports);
    const file = await batchFileByLink(link.token);
    const pdf = await getDocument({ data: new Uint8Array(file?.bytes ?? []) }).promise;
    expect(pdf.numPages).toBe(1000);
  });
});
