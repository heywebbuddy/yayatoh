import {
  createJourneyCommand,
  INVOICE_REMINDER_MESSAGES,
  invoiceRemindersTemplate,
  journeyInvoiceHooks,
  runDueActions,
  setJourneyEnabledCommand,
} from '@yayatoh/automations';
import { setFeeOverrideCommand } from '@yayatoh/billing';
import { admitBalanceDueCommand, scanTicketCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachInvoicePaymentCommand,
  eventInvoicesQuery,
  expireOrdersCommand,
  invoiceDocumentQuery,
  invoiceMailer,
  orderInvoiceQuery,
  publicInvoice,
  recordInvoicePaymentCommand,
  startInvoicePaymentCommand,
  voidInvoiceCommand,
} from '@yayatoh/orders';
import { consumeEvent, memoryNotifier, recentEventsTx, type Subscriber } from '@yayatoh/platform';
import {
  publicRegistration,
  registrantLifecycle,
  registrationCapacity,
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  setPayLaterCommand,
  startRegistrationCommand,
} from '@yayatoh/registration';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M5.1d: invoices, PO and pay later. Pay later per registration type with a PO rule; the order
 * waits in `awaiting_invoice` (never auto-cancelled); a $1,200 invoice paid in two parts (pay link +
 * a recorded wire) reconciles to the cent; pay links are idempotent; numbers are gap-free under
 * concurrency; the door and journeys follow the balance; void, permissions, impersonation and
 * isolation.
 */

let a: OrgFixture;
let b: OrgFixture;
let n = 0;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const anon = (o: OrgFixture = a, now?: Date): Ctx =>
  createCtx({ orgId: o.org.id, actor: { type: 'anonymous' }, ...(now ? { now } : {}) });
const sys = (o: OrgFixture = a) => systemCtx(o.org.id);
const viewer = () => userCtx(a.viewerId, a.org.id);
const acting = () => a.ctx({ impersonatedBy: { staffUserId: uuidv7(), impersonationId: uuidv7() } });
const mail = memoryNotifier();
const SUBSCRIBERS: Subscriber[] = [
  registrationCapacity(),
  registrantLifecycle(),
  invoiceMailer({ notifier: mail.notifier, appOrigin: 'https://app.test' }),
  journeyInvoiceHooks(),
];

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  // A platform fee on USD (2.5% + $0.99), so payments carry fee parts to reconcile.
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps: 250, fixedMinor: 99, reason: 'invoices test' },
    sys(),
    ports,
  );
});
afterAll(closePools);

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return `${err.code}${err.details?.reason ? `:${String(err.details.reason)}` : ''}`;
  }
}

async function drain(o: OrgFixture = a): Promise<void> {
  for (const s of SUBSCRIBERS) {
    const events = await withTenant(sys(o), (tx) =>
      recentEventsTx(tx, o.org.id, [...new Set(s.events.map((e) => e.split('@')[0] as string))], HOUR),
    );
    for (const e of events) await consumeEvent(s, e);
  }
}

interface Conf {
  eventId: string;
  slug: string;
  billed: string;
  member: string;
  fullPass: string;
  startsAt: Date;
}

/**
 * A published conference starting `daysOut` days from now (Chicago): "Billed" (pay later, PO per
 * `po`, a $1,200 all-in full pass, fee absorbed so the invoice is exactly $1,200.00) and the
 * default Member type (paid at checkout).
 */
async function conference(
  o: OrgFixture = a,
  opts: { daysOut?: number; po?: 'off' | 'optional' | 'required'; capacity?: number } = {},
): Promise<Conf> {
  n += 1;
  const startsAt = new Date(Date.now() + (opts.daysOut ?? 120) * DAY);
  const e = await executeCommand(
    createEventCommand,
    {
      name: `Invoices ${n} ${o.org.slug}`,
      timezone: 'America/Chicago',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 8 * HOUR).toISOString(),
    },
    o.ctx(),
    ports,
  );
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: e.id, names: {} }, o.ctx(), ports);
  const setup = await executeQuery(registrationSetupQuery, { eventId: e.id }, o.ctx(), ports);
  const member = setup.types.find((t) => t.key === 'member')?.id as string;
  const fullPass = setup.items.find((i) => i.key === 'full_pass')?.id as string;
  const { createRegistrationTypeCommand } = await import('@yayatoh/registration');
  const billed = await executeCommand(
    createRegistrationTypeCommand,
    { eventId: e.id, name: 'Billed', capacity: opts.capacity ?? null },
    o.ctx(),
    ports,
  );
  for (const [typeId, price] of [
    [billed.id, 120000],
    [member, 30000],
  ] as const)
    await executeCommand(
      setCellCommand,
      { eventId: e.id, registrationTypeId: typeId, admissionItemId: fullPass, priceMinor: price },
      o.ctx(),
      ports,
    );
  // The organizer absorbs the fee on the billed pass: its all-in price is the invoice total.
  await withTenant(sys(o), (tx) =>
    tx.execute(sql`update ticketing.ticket_types set fee_mode = 'absorb'
      where id = (select ticket_type_id from registration.type_items where registration_type_id = ${billed.id})`),
  );
  await executeCommand(
    setPayLaterCommand,
    { eventId: e.id, registrationTypeId: billed.id, payLater: true, poNumber: opts.po ?? 'optional' },
    o.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, o.ctx(), ports);
  const [ev] = await withTenant(sys(o), (tx) =>
    tx.execute<{ slug: string }>(sql`select slug from events.events where id = ${e.id}`),
  );
  return { eventId: e.id, slug: ev?.slug ?? '', billed: billed.id, member, fullPass, startsAt };
}

const register = (
  c: Conf,
  email: string,
  payLater: Record<string, unknown> | null = { poNumber: 'PO-77', billingCompany: 'Acme Corp' },
  typeId = c.billed,
  o: OrgFixture = a,
) =>
  executeCommand(
    startRegistrationCommand,
    {
      eventId: c.eventId,
      registrationTypeId: typeId,
      itemIds: [c.fullPass],
      buyer: { email, name: `Buyer ${email.split('@')[0]}` },
      locale: 'en',
      ...(payLater ? { payLater } : {}),
    },
    anon(o),
    ports,
  );

const invoiceOf = (orderId: string, ctx = a.ctx()) =>
  executeQuery(orderInvoiceQuery, { orderId }, ctx, ports);

async function ticketsOf(orderId: string, o: OrgFixture = a) {
  return withTenant(sys(o), (tx) =>
    tx.execute<{ id: string; short_code: string; status: string; payment_due: boolean }>(
      sql`select id, short_code, status, payment_due from ticketing.tickets where order_id = ${orderId} order by serial`,
    ),
  );
}

async function orderRow(orderId: string, o: OrgFixture = a) {
  const [r] = await withTenant(sys(o), (tx) =>
    tx.execute<{ status: string; total_minor: string; fee_minor: string; expires_at: Date | null }>(
      sql`select status, total_minor, fee_minor, expires_at from orders.orders where id = ${orderId}`,
    ),
  );
  return r;
}

/** Pay part of an invoice by its link, as the buyer's browser and the provider's webhook would. */
async function payByLink(token: string, orderId: string, amountMinor: number, key = uuidv7()) {
  const start = await executeCommand(
    startInvoicePaymentCommand,
    { token, amountMinor },
    { ...anon(), idempotencyKey: key },
    ports,
  );
  const pi = `fakepi_inv_${start.paymentId.replace(/-/g, '').slice(-16)}`;
  await executeCommand(
    attachInvoicePaymentCommand,
    { paymentId: start.paymentId, provider: 'fake', providerPaymentId: pi },
    anon(),
    ports,
  );
  const evtId = `fakeevt_${uuidv7()}`;
  const applied = await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: evtId,
      type: 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor,
      currency: 'USD',
      orgId: a.org.id,
      orderId,
    },
    sys(),
    ports,
  );
  return { start, pi, evtId, applied };
}

describe('pay later per registration type (P5-5)', () => {
  it('only types that opt in offer it, and a required PO number is enforced', async () => {
    const c = await conference(a, { po: 'required' });
    const pub = await publicRegistration(a.org.id, c.eventId, { email: 'x@corp.test' });
    expect(pub.types.find((t) => t.id === c.billed)).toMatchObject({ payLater: true, poNumber: 'required' });
    expect(pub.types.find((t) => t.id === c.member)).toMatchObject({ payLater: false, poNumber: 'off' });
    expect(await code(register(c, 'nopo@corp.test', { poNumber: '  ' }))).toBe(
      'validation_failed:po_required',
    );
    expect(await code(register(c, 'member@corp.test', {}, c.member))).toBe('forbidden:pay_later_off');
    // Viewers can't change the rule; approval and +1 types can't offer it.
    expect(
      await code(
        executeCommand(
          setPayLaterCommand,
          { eventId: c.eventId, registrationTypeId: c.billed, payLater: false },
          viewer(),
          ports,
        ),
      ),
    ).toBe('forbidden');
  });

  it('registers now: the order awaits its invoice, the place is sold, tickets carry the balance flag', async () => {
    const c = await conference(a, { po: 'required' });
    const r = await register(c, 'ada@corp.test', { poNumber: ' PO  4471 ', billingCompany: 'Acme Corp' });
    expect(r.order.status).toBe('awaiting_invoice');
    expect(r.invoiceToken).toMatch(/~/);
    const order = await orderRow(r.order.id);
    expect(order?.status).toBe('awaiting_invoice');
    expect(order?.expires_at).toBeNull();
    const inv = await invoiceOf(r.order.id);
    expect(inv).toMatchObject({
      status: 'open',
      poNumber: 'PO 4471',
      billingCompany: 'Acme Corp',
      totalMinor: 120000,
      paidMinor: 0,
      balanceMinor: 120000,
      overdue: false,
    });
    expect(inv?.label).toMatch(/^INV-\d{5}$/);
    const tickets = await ticketsOf(r.order.id);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ status: 'active', payment_due: true });
    // The place counts as sold; the registrant is confirmed with the ticket.
    const setup = await executeQuery(registrationSetupQuery, { eventId: c.eventId }, a.ctx(), ports);
    expect(setup.types.find((t) => t.id === c.billed)).toMatchObject({ quantitySold: 1, quantityHeld: 0 });
    const [reg] = await withTenant(sys(), (tx) =>
      tx.execute<{ status: string }>(
        sql`select status from registration.registrants where order_id = ${r.order.id}`,
      ),
    );
    expect(reg?.status).toBe('confirmed');
    // No money yet: nothing on the ledger for the order.
    const [j] = await withTenant(sys(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from payments.journal_entries where ref_id = ${r.order.id}`,
      ),
    );
    expect(j?.n).toBe(0);
    // The buyer is emailed the invoice with their own link (dev mailbox in the app).
    await drain();
    const email = mail.sent.find((m) => m.kind === 'orders.invoice' && m.orderId === r.order.id);
    expect(email?.params).toMatchObject({ number: inv?.label, amountMinor: 120000, dueOn: inv?.dueOn });
    expect(String(email?.params.url)).toContain(`/events/${c.slug}/invoice/`);
    // The document and the buyer's page show it (allowlisted).
    const doc = await executeQuery(invoiceDocumentQuery, { orderId: r.order.id }, a.ctx(), ports);
    expect(doc.lines).toEqual([
      { name: 'Billed · Full pass', quantity: 1, unitMinor: 120000, totalMinor: 120000 },
    ]);
    const pub = await publicInvoice(a.org.id, c.eventId, r.invoiceToken as string);
    expect(pub).toMatchObject({ label: inv?.label, balanceMinor: 120000, poNumber: 'PO 4471' });
    expect(pub).not.toHaveProperty('feeMinor');
    expect(pub).not.toHaveProperty('voidReason');
  });

  it('terms: Net 30 from the invoice date, but due no later than 7 days before the event', async () => {
    const far = await conference(a, { daysOut: 120 });
    const r1 = await register(far, 'far@corp.test');
    const i1 = await invoiceOf(r1.order.id);
    expect(Date.parse(`${i1?.dueOn}T00:00:00Z`) - Date.parse(`${i1?.issuedOn}T00:00:00Z`)).toBe(30 * DAY);
    const near = await conference(a, { daysOut: 20 });
    const r2 = await register(near, 'near@corp.test');
    const i2 = await invoiceOf(r2.order.id);
    const start = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(near.startsAt);
    expect(Date.parse(`${start}T00:00:00Z`) - Date.parse(`${i2?.dueOn}T00:00:00Z`)).toBe(7 * DAY);
    const close = await conference(a, { daysOut: 3 });
    const r3 = await register(close, 'close@corp.test');
    const i3 = await invoiceOf(r3.order.id);
    expect(i3?.dueOn).toBe(i3?.issuedOn);
  });
});

describe('a $1,200 invoice paid in two parts reconciles to the cent', () => {
  it('half by the pay link, the rest by a recorded wire: paid, ledger memos and fee receivable', async () => {
    const c = await conference();
    const r = await register(c, 'twoparts@corp.test');
    const token = r.invoiceToken as string;
    const order = await orderRow(r.order.id);
    const fee = Number(order?.fee_minor);
    expect(Number(order?.total_minor)).toBe(120000);
    // 2.5% of $1,200 + $0.99, absorbed by the organizer.
    expect(fee).toBe(3099);

    const first = await payByLink(token, r.order.id, 60000);
    expect(first.applied).toMatchObject({ outcome: 'applied', status: 'awaiting_invoice' });
    let inv = await invoiceOf(r.order.id);
    expect(inv).toMatchObject({ status: 'open', paidMinor: 60000, balanceMinor: 60000 });
    expect((await ticketsOf(r.order.id))[0]?.payment_due).toBe(true);

    const wire = await executeCommand(
      recordInvoicePaymentCommand,
      {
        orderId: r.order.id,
        amountMinor: 60000,
        method: 'wire',
        reference: 'WIRE-2026-0042',
        receivedOn: new Date().toISOString().slice(0, 10),
        note: 'Received from Acme AP.',
      },
      a.ctx({ idempotencyKey: `wire-${r.order.id}` }),
      ports,
    );
    expect(wire).toMatchObject({ status: 'paid', paidMinor: 120000, balanceMinor: 0 });
    inv = await invoiceOf(r.order.id);
    expect(inv).toMatchObject({ status: 'paid', paidMinor: 120000, balanceMinor: 0 });
    expect(inv?.feeAllocatedMinor).toBe(fee);
    expect(inv?.payments.map((p) => [p.channel, p.method, p.amountMinor])).toEqual([
      ['pay_link', 'card', 60000],
      ['offline', 'wire', 60000],
    ]);
    expect((inv?.payments ?? []).reduce((s, p) => s + p.feePartMinor, 0)).toBe(fee);
    expect((await orderRow(r.order.id))?.status).toBe('paid');
    expect((await ticketsOf(r.order.id))[0]?.payment_due).toBe(false);

    // The ledger: one journal per payment (keyed by the payment), memos with gross and fee part.
    const lines = await withTenant(sys(), (tx) =>
      tx.execute<{ kind: string; memo: Record<string, unknown>; account: string; amount: string }>(sql`
        select j.kind, j.memo, p.account, p.amount_minor::text as amount
        from payments.journal_entries j join payments.postings p on p.journal_id = j.id
        where j.ref_id = ${r.order.id} and j.idempotency_key like 'invoice_payment:%'
        order by j.created_at, p.account`),
    );
    const card = lines.filter((l) => l.kind === 'sale');
    const offline = lines.filter((l) => l.kind === 'organizer_collected_sale');
    const f1 = Number(card[0]?.memo.feeMinor);
    const f2 = Number(offline[0]?.memo.feeMinor);
    expect(f1 + f2).toBe(fee);
    expect(card[0]?.memo).toMatchObject({
      grossMinor: 60000,
      channel: 'pay_link',
      fundsFlow: 'platform_mor',
    });
    expect(offline[0]?.memo).toMatchObject({
      grossMinor: 60000,
      channel: 'offline',
      collectedBy: 'organizer',
    });
    const amount = (rows: typeof lines, account: string) =>
      rows.filter((l) => l.account === account).reduce((s, l) => s + Number(l.amount), 0);
    expect(amount(card, 'platform:stripe_cash')).toBe(60000);
    expect(amount(card, 'org:payable_held')).toBe(-(60000 - f1));
    expect(amount(card, 'platform:platform_fee_deferred')).toBe(-f1);
    expect(amount(offline, 'org:receivable')).toBe(f2);
    expect(amount(offline, 'platform:platform_fee_deferred')).toBe(-f2);
    // Every journal balances; cash + organizer share + fee = what the buyer paid, to the cent.
    expect(lines.reduce((s, l) => s + Number(l.amount), 0)).toBe(0);
    expect(amount(card, 'platform:stripe_cash') + 60000).toBe(120000);

    // Paid: order.paid (via invoice) went out, so the order's buyer journey and ticket mail follow.
    const [paid] = await withTenant(sys(), (tx) =>
      tx.execute<{ payload: { via: string } }>(sql`
        select payload from platform.domain_events where aggregate_id = ${r.order.id} and type = 'order.paid'`),
    );
    expect(paid?.payload.via).toBe('invoice');
    // Overpaying, or paying a paid invoice, is refused.
    expect(
      await code(
        executeCommand(
          startInvoicePaymentCommand,
          { token, amountMinor: 100 },
          { ...anon(), idempotencyKey: uuidv7() },
          ports,
        ),
      ),
    ).toBe('invalid_state:invoice_paid');
  });

  it('validates amounts and dates, and refuses viewers and staff acting as a member', async () => {
    const c = await conference();
    const r = await register(c, 'checks@corp.test');
    const today = new Date().toISOString().slice(0, 10);
    const rec = (input: Record<string, unknown>, ctx: Ctx = a.ctx({ idempotencyKey: uuidv7() })) =>
      code(
        executeCommand(
          recordInvoicePaymentCommand,
          { orderId: r.order.id, amountMinor: 1000, method: 'check', receivedOn: today, ...input },
          ctx,
          ports,
        ),
      );
    expect(await rec({ amountMinor: 120001 })).toBe('validation_failed:amount_too_large');
    expect(await rec({ receivedOn: '2999-01-01' })).toBe('validation_failed:date_in_future');
    expect(await rec({}, { ...viewer(), idempotencyKey: uuidv7() })).toBe('forbidden');
    expect(await rec({}, { ...acting(), idempotencyKey: uuidv7() })).toBe('impersonation_blocked:money');
    expect(await rec({}, a.ctx())).toBe('validation_failed');
    expect(
      await code(
        executeCommand(
          startInvoicePaymentCommand,
          { token: r.invoiceToken as string, amountMinor: 120001 },
          { ...anon(), idempotencyKey: uuidv7() },
          ports,
        ),
      ),
    ).toBe('validation_failed:amount_too_large');
    // Recording is idempotent: the same key replays the same payment.
    const key = `check-${r.order.id}`;
    const one = await executeCommand(
      recordInvoicePaymentCommand,
      { orderId: r.order.id, amountMinor: 1000, method: 'check', reference: 'CHK 1', receivedOn: today },
      a.ctx({ idempotencyKey: key }),
      ports,
    );
    const two = await executeCommand(
      recordInvoicePaymentCommand,
      { orderId: r.order.id, amountMinor: 1000, method: 'check', reference: 'CHK 1', receivedOn: today },
      a.ctx({ idempotencyKey: key }),
      ports,
    );
    expect(two.paymentId).toBe(one.paymentId);
    expect((await invoiceOf(r.order.id))?.paidMinor).toBe(1000);
    // The audit keeps the reference.
    const [audit] = await withTenant(sys(), (tx) =>
      tx.execute<{ data: Record<string, unknown> }>(sql`
        select data from platform.audit_events where action = 'order.invoice.payment_recorded'
        and target_id = ${r.order.id} order by seq desc limit 1`),
    );
    expect(audit?.data).toMatchObject({ method: 'check', reference: 'CHK 1', amountMinor: 1000 });
  });
});

describe('an idempotency key on every pay link: replaying it never double-charges', () => {
  it('the same pay request returns the same payment; replayed and repeated webhooks count once', async () => {
    const c = await conference();
    const r = await register(c, 'replay@corp.test');
    const token = r.invoiceToken as string;
    const key = uuidv7();
    const first = await payByLink(token, r.order.id, 30000, key);
    // The browser resubmits the same pay form (same key): the same payment, not a new one.
    const again = await executeCommand(
      startInvoicePaymentCommand,
      { token, amountMinor: 30000 },
      { ...anon(), idempotencyKey: key },
      ports,
    );
    expect(again.paymentId).toBe(first.start.paymentId);
    // Attaching the same provider payment again changes nothing.
    expect(
      await executeCommand(
        attachInvoicePaymentCommand,
        { paymentId: first.start.paymentId, provider: 'fake', providerPaymentId: first.pi },
        anon(),
        ports,
      ),
    ).toEqual({ attached: false });
    // The provider retries the same webhook, and sends a second event for the same payment.
    const replay = (id: string) =>
      executeCommand(
        applyProviderEventCommand,
        {
          provider: 'fake',
          id,
          type: 'payment.succeeded',
          providerPaymentId: first.pi,
          amountMinor: 30000,
          currency: 'USD',
          orgId: a.org.id,
          orderId: r.order.id,
        },
        sys(),
        ports,
      );
    expect((await replay(first.evtId)).outcome).toBe('duplicate');
    expect((await replay(`fakeevt_${uuidv7()}`)).outcome).toBe('ignored');
    const inv = await invoiceOf(r.order.id);
    expect(inv?.paidMinor).toBe(30000);
    const [j] = await withTenant(sys(), (tx) =>
      tx.execute<{ n: number }>(sql`
        select count(*)::int as n from payments.journal_entries
        where ref_id = ${r.order.id} and idempotency_key like 'invoice_payment:%'`),
    );
    expect(j?.n).toBe(1);
    // A pay request without a key is refused; a mismatching webhook too.
    expect(
      await code(executeCommand(startInvoicePaymentCommand, { token, amountMinor: 100 }, anon(), ports)),
    ).toBe('validation_failed');
    expect(
      await code(
        executeCommand(
          applyProviderEventCommand,
          {
            provider: 'fake',
            id: `fakeevt_${uuidv7()}`,
            type: 'payment.succeeded',
            providerPaymentId: first.pi,
            amountMinor: 30001,
            currency: 'USD',
            orgId: a.org.id,
            orderId: r.order.id,
          },
          sys(),
          ports,
        ),
      ),
    ).toBe('conflict');
  });

  it('a declined card leaves the balance as it was', async () => {
    const c = await conference();
    const r = await register(c, 'declined@corp.test');
    const start = await executeCommand(
      startInvoicePaymentCommand,
      { token: r.invoiceToken as string, amountMinor: 5000 },
      { ...anon(), idempotencyKey: uuidv7() },
      ports,
    );
    await executeCommand(
      attachInvoicePaymentCommand,
      { paymentId: start.paymentId, provider: 'fake', providerPaymentId: `fakepi_decl_${start.paymentId}` },
      anon(),
      ports,
    );
    await executeCommand(
      applyProviderEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_${uuidv7()}`,
        type: 'payment.failed',
        providerPaymentId: `fakepi_decl_${start.paymentId}`,
        amountMinor: 5000,
        currency: 'USD',
        orgId: a.org.id,
        orderId: r.order.id,
      },
      sys(),
      ports,
    );
    const inv = await invoiceOf(r.order.id);
    expect(inv).toMatchObject({ paidMinor: 0, status: 'open' });
    expect(inv?.payments.map((p) => p.status)).toEqual(['failed']);
  });
});

describe('invoice numbers are gap-free under concurrency', () => {
  it('concurrent registrations take consecutive numbers; a failed one takes none', async () => {
    const c = await conference(a, { po: 'required' });
    const before = await executeQuery(eventInvoicesQuery, { eventId: c.eventId }, a.ctx(), ports);
    expect(before).toEqual([]);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        register(c, `conc${i}@corp.test`, i === 3 ? { poNumber: '' } : { poNumber: `PO-${i}` }),
      ),
    );
    expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
    const all = await withTenant(sys(), (tx) =>
      tx.execute<{ number: number }>(sql`select number from orders.invoices order by number`),
    );
    const numbers = all.map((r) => r.number);
    // Across the whole org: 1…N with no gap and no repeat.
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
    const mine = await executeQuery(eventInvoicesQuery, { eventId: c.eventId }, a.ctx(), ports);
    expect(mine).toHaveLength(7);
  });
});

describe('an unpaid registration is never auto-cancelled', () => {
  it('the hold sweeper long after the due date leaves the order, tickets and registrant alone', async () => {
    const c = await conference(a, { daysOut: 5 });
    const r = await register(c, 'late@corp.test');
    const later = new Date(Date.now() + 60 * DAY);
    await executeCommand(expireOrdersCommand, { limit: 500 }, { ...sys(), now: later }, ports);
    await drain();
    expect((await orderRow(r.order.id))?.status).toBe('awaiting_invoice');
    expect((await ticketsOf(r.order.id))[0]).toMatchObject({ status: 'active', payment_due: true });
    const [reg] = await withTenant(sys(), (tx) =>
      tx.execute<{ status: string }>(
        sql`select status from registration.registrants where order_id = ${r.order.id}`,
      ),
    );
    expect(reg?.status).toBe('confirmed');
    const overdue = await executeQuery(
      eventInvoicesQuery,
      { eventId: c.eventId, filter: 'overdue' },
      a.ctx({ now: later }),
      ports,
    );
    expect(overdue.map((x) => x.orderId)).toContain(r.order.id);
  });

  it('only the organizer voids an unpaid invoice: tickets, place and registrant go; never once paid', async () => {
    const c = await conference(a, { capacity: 1 });
    const r = await register(c, 'void@corp.test');
    const v = (ctx: Ctx, orderId = r.order.id) =>
      code(executeCommand(voidInvoiceCommand, { orderId, reason: 'Duplicate registration.' }, ctx, ports));
    expect(await v(viewer())).toBe('forbidden');
    expect(await v(acting())).toBe('impersonation_blocked:money');
    // Full: a second registration is refused until the void frees the place.
    expect(await code(register(c, 'second@corp.test'))).toBe('conflict:type_full');
    expect(await v(a.ctx())).toBe('ok');
    expect((await orderRow(r.order.id))?.status).toBe('void');
    expect((await ticketsOf(r.order.id))[0]).toMatchObject({ status: 'void', payment_due: false });
    expect((await invoiceOf(r.order.id))?.status).toBe('void');
    await drain();
    const setup = await executeQuery(registrationSetupQuery, { eventId: c.eventId }, a.ctx(), ports);
    expect(setup.types.find((t) => t.id === c.billed)).toMatchObject({ quantitySold: 0, quantityHeld: 0 });
    expect(await code(register(c, 'second@corp.test'))).toBe('ok');
    // A partly paid invoice cannot be voided; its number is never reused.
    const c2 = await conference();
    const r2 = await register(c2, 'partial@corp.test');
    await payByLink(r2.invoiceToken as string, r2.order.id, 1000);
    expect(await v(a.ctx(), r2.order.id)).toBe('invalid_state:has_payments');
  });
});

describe('balance due at the door: refused without, admitted with an audited override', () => {
  it('scans balance_due, the override admits with the reason audited, paying clears the flag', async () => {
    const c = await conference(a, { daysOut: 2 });
    const r = await register(c, 'door@corp.test');
    const [t] = await ticketsOf(r.order.id);
    const atDoor = a.ctx({ now: new Date(c.startsAt.getTime() + HOUR) });
    const scan = await executeCommand(
      scanTicketCommand,
      { eventId: c.eventId, code: t?.short_code as string },
      atDoor,
      ports,
    );
    expect(scan).toMatchObject({ result: 'balance_due', admissionId: null });
    expect(scan.ticket?.shortCode).toBe(t?.short_code);
    expect(
      await code(
        executeCommand(
          admitBalanceDueCommand,
          { eventId: c.eventId, code: t?.short_code as string, note: 'x' },
          atDoor,
          ports,
        ),
      ),
    ).toBe('validation_failed');
    const ok = await executeCommand(
      admitBalanceDueCommand,
      { eventId: c.eventId, code: t?.short_code as string, note: 'Finance confirmed the PO is in process.' },
      atDoor,
      ports,
    );
    expect(ok.result).toBe('admitted');
    const [adm] = await withTenant(sys(), (tx) =>
      tx.execute<{ balance_override: boolean }>(
        sql`select balance_override from checkin.admissions where id = ${ok.admissionId}`,
      ),
    );
    expect(adm?.balance_override).toBe(true);
    const [audit] = await withTenant(sys(), (tx) =>
      tx.execute<{ data: Record<string, unknown>; target_id: string }>(sql`
        select data, target_id from platform.audit_events where action = 'checkin.balance_override'
        order by seq desc limit 1`),
    );
    expect(audit).toMatchObject({
      target_id: t?.id,
      data: { note: 'Finance confirmed the PO is in process.' },
    });
    // A second scan that day is a duplicate, not a second refusal.
    expect(
      (
        await executeCommand(
          scanTicketCommand,
          { eventId: c.eventId, code: t?.short_code as string },
          atDoor,
          ports,
        )
      ).result,
    ).toBe('duplicate');
    // Once paid, the next day's scan admits with no override.
    await payByLink(r.invoiceToken as string, r.order.id, 120000);
    expect((await ticketsOf(r.order.id))[0]?.payment_due).toBe(false);
    expect(
      await code(
        executeCommand(
          admitBalanceDueCommand,
          { eventId: c.eventId, code: t?.short_code as string, note: 'Again please.' },
          atDoor,
          ports,
        ),
      ),
    ).toBe('invalid_state:no_balance_due');
  });
});

describe('reminders on journeys stop on payment', () => {
  it('an invoice_issued journey enrolls the buyer from the due date and is cancelled when paid', async () => {
    const c = await conference(a, { daysOut: 120 });
    const copy = Object.fromEntries(
      INVOICE_REMINDER_MESSAGES.map((k) => [
        k,
        { subject: `${k} {invoice}`, body: 'Due {due}: {balance}. {link}' },
      ]),
    ) as Parameters<typeof invoiceRemindersTemplate>[0];
    const tpl = invoiceRemindersTemplate(copy);
    const j = await executeCommand(
      createJourneyCommand,
      {
        name: `Invoice reminders ${n}`,
        eventId: c.eventId,
        seriesId: null,
        trigger: tpl.trigger,
        template: 'invoice_reminders',
        steps: tpl.steps,
      },
      a.ctx(),
      ports,
    );
    await executeCommand(setJourneyEnabledCommand, { journeyId: j.id, enabled: true }, a.ctx(), ports);
    const r = await register(c, 'remind@corp.test');
    await drain();
    const inv = await invoiceOf(r.order.id);
    const rows = await withTenant(sys(), (tx) =>
      tx.execute<{ status: string; scheduled_for: Date; position: number }>(sql`
        select a.status, a.scheduled_for, a.position from automations.scheduled_actions a
        join automations.journey_runs r on r.id = a.run_id
        where r.order_id = ${r.order.id} and r.trigger = 'invoice_issued' order by a.position`),
    );
    expect(rows.map((x) => x.status)).toEqual(['pending', 'pending', 'pending']);
    // 09:00 in Chicago, 7 days before, on, and 7 days after the due date.
    const local = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(d));
    expect(local(rows[1]?.scheduled_for as Date)).toBe(`${inv?.dueOn}, 09:00`);
    // The "before" reminder runs when due and fills the invoice placeholders.
    const sent = memoryNotifier();
    await runDueActions(a.org.id, { notifier: sent.notifier, appOrigin: 'https://app.test' }, ports, {
      now: new Date(new Date(rows[0]?.scheduled_for as Date).getTime() + 60_000),
    });
    const msg = sent.sent.find((m) => m.kind === 'automations.message');
    expect(msg?.params.subject).toBe(`before ${inv?.label}`);
    expect(String(msg?.params.body)).toContain('$1,200.00');
    expect(String(msg?.params.body)).toContain(`https://app.test/events/${c.slug}/invoice/`);
    // Paid in full: what is still pending is cancelled.
    await payByLink(r.invoiceToken as string, r.order.id, 120000);
    await drain();
    const after = await withTenant(sys(), (tx) =>
      tx.execute<{ status: string; outcome: string | null }>(sql`
        select a.status, a.outcome from automations.scheduled_actions a
        join automations.journey_runs r on r.id = a.run_id
        where r.order_id = ${r.order.id} and r.trigger = 'invoice_issued' order by a.position`),
    );
    expect(after.map((x) => `${x.status}:${x.outcome}`)).toEqual([
      'done:queued',
      'cancelled:invoice_paid',
      'cancelled:invoice_paid',
    ]);
  });
});

describe('isolation', () => {
  it("another org never sees an invoice, and a link from one org doesn't open in another", async () => {
    const c = await conference(a);
    const r = await register(c, 'iso@corp.test');
    expect(await invoiceOf(r.order.id, b.ctx())).toBeNull();
    expect(await code(executeQuery(invoiceDocumentQuery, { orderId: r.order.id }, b.ctx(), ports))).toBe(
      'not_found',
    );
    expect(await code(publicInvoice(b.org.id, c.eventId, r.invoiceToken as string))).toBe('not_found');
    expect(
      await code(
        executeCommand(
          recordInvoicePaymentCommand,
          {
            orderId: r.order.id,
            amountMinor: 100,
            method: 'cash',
            receivedOn: new Date().toISOString().slice(0, 10),
          },
          b.ctx({ idempotencyKey: uuidv7() }),
          ports,
        ),
      ),
    ).toBe('not_found');
    expect(
      await code(
        executeCommand(
          startInvoicePaymentCommand,
          { token: r.invoiceToken as string, amountMinor: 100 },
          { ...anon(b), idempotencyKey: uuidv7() },
          ports,
        ),
      ),
    ).toBe('not_found');
    // A forged token is refused.
    expect(await code(publicInvoice(a.org.id, c.eventId, `${uuidv7()}~${'0'.repeat(43)}`))).toBe('not_found');
  });
});
