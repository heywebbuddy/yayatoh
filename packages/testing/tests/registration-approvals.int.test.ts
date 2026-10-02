import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { applyProviderEventCommand, attachPaymentCommand, expireOrdersCommand } from '@yayatoh/orders';
import {
  bulkStepCommand,
  consumeEvent,
  memoryNotifier,
  type Subscriber,
  recentEventsTx,
} from '@yayatoh/platform';
import {
  addGuestCommand,
  applyCommand,
  approvalSetupQuery,
  createRegistrationTypeCommand,
  decideRegistrantCommand,
  decisionMailer,
  groupToken,
  joinRegistrationWaitlistCommand,
  payApprovedCommand,
  publicGroup,
  publicRegistrant,
  publicRegistration,
  registrantDetailQuery,
  registrantLifecycle,
  registrantToken,
  registrationCapacity,
  registrationDecideAction,
  registrationDecideBulk,
  registrationQueueQuery,
  registrationSetupQuery,
  removeReasonTemplateCommand,
  replaceMembersCommand,
  saveReasonTemplateCommand,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  setTypeRulesCommand,
  startGroupCommand,
  startRegistrationCommand,
  substituteByPayerCommand,
  substituteRegistrantCommand,
} from '@yayatoh/registration';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M5.1c: apply-to-attend with auto-approval (domain, member list), single and bulk decisions with
 * reasons and emails, the pay link (idempotent; nobody charged before approval), capacity under
 * concurrent approvals, group registration with substitution, +1 guest types, isolation.
 */

let a: OrgFixture;
let b: OrgFixture;
let n = 0;
const HOUR = 3_600_000;
const STARTS = '2027-11-01T14:00:00Z';
const anon = (o: OrgFixture = a, now?: Date): Ctx =>
  createCtx({ orgId: o.org.id, actor: { type: 'anonymous' }, ...(now ? { now } : {}) });
const sys = () => systemCtx(a.org.id);
const viewer = () => userCtx(a.viewerId, a.org.id);
const mail = memoryNotifier();
const SUBSCRIBERS: Subscriber[] = [
  registrationCapacity(),
  registrantLifecycle(),
  decisionMailer({ notifier: mail.notifier, appOrigin: 'https://app.test' }),
];

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
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

/** Run the registration subscribers over this org's recent events (as the worker would). */
async function drain(o: OrgFixture = a): Promise<void> {
  for (const s of SUBSCRIBERS) {
    const events = await withTenant(systemCtx(o.org.id), (tx) =>
      recentEventsTx(tx, o.org.id, [...new Set(s.events.map((e) => e.split('@')[0] as string))], HOUR),
    );
    for (const e of events) await consumeEvent(s, e);
  }
}

interface Conf {
  eventId: string;
  member: string;
  student: string;
  fullPass: string;
  dinner: string;
  apply: string;
}

/**
 * A published conference: Member (open, $300 full pass, dinner add-on), Student (domain
 * uni.test, $100) and "Applicants" (approval; $400 unless `free`).
 */
async function conference(opts: { capacity?: number | null; free?: boolean } = {}): Promise<Conf> {
  n += 1;
  const e = await executeCommand(
    createEventCommand,
    {
      name: `Approvals ${n} ${a.org.slug}`,
      timezone: 'America/Chicago',
      startsAt: STARTS,
      endsAt: '2027-11-03T23:00:00Z',
    },
    a.ctx(),
    ports,
  );
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: e.id, names: {} }, a.ctx(), ports);
  const setup = await executeQuery(registrationSetupQuery, { eventId: e.id }, a.ctx(), ports);
  const type = (key: string) => setup.types.find((t) => t.key === key)?.id as string;
  const item = (key: string) => setup.items.find((i) => i.key === key)?.id as string;
  const apply = await executeCommand(
    createRegistrationTypeCommand,
    { eventId: e.id, name: 'Applicants', capacity: opts.capacity ?? null },
    a.ctx(),
    ports,
  );
  const student = await executeCommand(
    createRegistrationTypeCommand,
    { eventId: e.id, name: 'Uni', eligibility: 'email_domain', emailDomains: ['uni.test'] },
    a.ctx(),
    ports,
  );
  for (const [typeId, itemId, price] of [
    [type('member'), item('full_pass'), 30000],
    [type('member'), item('dinner'), 5000],
    [student.id, item('full_pass'), 10000],
    [apply.id, item('full_pass'), opts.free ? 0 : 40000],
  ] as const)
    await executeCommand(
      setCellCommand,
      { eventId: e.id, registrationTypeId: typeId, admissionItemId: itemId, priceMinor: price },
      a.ctx(),
      ports,
    );
  await executeCommand(
    setTypeRulesCommand,
    {
      eventId: e.id,
      registrationTypeId: apply.id,
      approval: 'manual',
      autoApproveDomains: ['partner.test'],
      kind: 'standard',
    },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
  return {
    eventId: e.id,
    member: type('member'),
    student: student.id,
    fullPass: item('full_pass'),
    dinner: item('dinner'),
    apply: apply.id,
  };
}

const applyAs = (c: Conf, email: string, extra: Record<string, unknown> = {}) =>
  executeCommand(
    applyCommand,
    {
      eventId: c.eventId,
      registrationTypeId: c.apply,
      admissionItemId: c.fullPass,
      name: `Applicant ${email.split('@')[0]}`,
      email,
      company: 'Acme',
      jobTitle: 'Engineer',
      message: 'I would like to attend.',
      ...extra,
    },
    anon(),
    ports,
  );

const decide = (c: Conf, registrantId: string, decision: 'approve' | 'deny', ctx = a.ctx(), reason?: string) =>
  executeCommand(
    decideRegistrantCommand,
    { eventId: c.eventId, registrantId, decision, ...(reason ? { reason } : {}) },
    ctx,
    ports,
  );

const status = async (id: string) =>
  withTenant(sys(), async (tx) => {
    const [r] = await tx.execute<{ status: string; order_id: string | null; ticket_id: string | null }>(
      sql`select status, order_id, ticket_id from registration.registrants where id = ${id}`,
    );
    return r;
  });

const ordersOf = async (email: string) =>
  withTenant(sys(), async (tx) => {
    const [r] = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from orders.orders where buyer_email = ${email}`,
    );
    return r?.n ?? 0;
  });

/** Pay an order through the fake provider (webhook applied), as the payment page would. */
async function pay(orderId: string, totalMinor: number): Promise<void> {
  const tag = uuidv7().slice(-12);
  await executeCommand(
    attachPaymentCommand,
    { orderId, provider: 'fake', providerPaymentId: `fakepi_appr_${tag}` },
    anon(),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_appr_${tag}`,
      type: 'payment.succeeded',
      providerPaymentId: `fakepi_appr_${tag}`,
      amountMinor: totalMinor,
      currency: 'USD',
      orgId: a.org.id,
      orderId,
    },
    sys(),
    ports,
  );
  await drain();
}

const tag = () => uuidv7().slice(-8);

describe('apply to attend (M5.1c)', () => {
  it('applying makes a pending application with no order: nobody is charged before approval', async () => {
    const c = await conference();
    const email = `pending-${tag()}@example.test`;
    const r = await applyAs(c, email);
    expect(r).toMatchObject({ status: 'pending', alreadyApplied: false });
    expect(await ordersOf(email)).toBe(0);
    // Applying again returns the same application.
    const again = await applyAs(c, email);
    expect(again).toMatchObject({ registrantId: r.registrantId, alreadyApplied: true });
    // The public checkout and the waitlist can't skip the application.
    expect(
      await code(
        executeCommand(
          startRegistrationCommand,
          {
            eventId: c.eventId,
            registrationTypeId: c.apply,
            itemIds: [c.fullPass],
            buyer: { email, name: 'Skipper' },
          },
          anon(),
          ports,
        ),
      ),
    ).toBe('forbidden:approval_required');
    expect(
      await code(
        executeCommand(
          joinRegistrationWaitlistCommand,
          {
            eventId: c.eventId,
            registrationTypeId: c.apply,
            admissionItemId: c.fullPass,
            name: 'Skipper',
            email,
          },
          anon(),
          ports,
        ),
      ),
    ).toBe('forbidden:approval_required');
    // The pay link refuses a pending application.
    expect(
      await code(executeCommand(payApprovedCommand, { token: r.token }, anon(), ports)),
    ).toBe('forbidden:not_approved');
    expect(await ordersOf(email)).toBe(0);
    // The public list shows the type as one to apply for.
    const pub = await publicRegistration(a.org.id, c.eventId, { email });
    expect(pub.types.find((t) => t.id === c.apply)).toMatchObject({ apply: true });
    expect(pub.types.find((t) => t.id === c.member)).toMatchObject({ apply: false });
  });

  it('auto-approves by email domain (subdomains too) and by the member list', async () => {
    const c = await conference();
    const byDomain = await applyAs(c, `ana-${tag()}@eu.partner.test`);
    expect(byDomain.status).toBe('approved');
    await executeCommand(
      replaceMembersCommand,
      { eventId: c.eventId, registrationTypeId: c.apply, emails: ['Listed@Members.test'] },
      a.ctx(),
      ports,
    );
    const setup = await executeQuery(approvalSetupQuery, { eventId: c.eventId }, a.ctx(), ports);
    expect(setup.types.find((t) => t.registrationTypeId === c.apply)).toMatchObject({
      approval: 'manual',
      autoApproveDomains: ['partner.test'],
      members: 1,
    });
    const listed = await applyAs(c, 'listed@members.test');
    expect(listed.status).toBe('approved');
    const other = await applyAs(c, `other-${tag()}@badpartner.test`);
    expect(other.status).toBe('pending');
    const detail = await executeQuery(
      registrantDetailQuery,
      { eventId: c.eventId, registrantId: listed.registrantId },
      a.ctx(),
      ports,
    );
    expect(detail).toMatchObject({ decisionSource: 'auto_member', company: 'Acme', message: 'I would like to attend.' });
  });

  it('a free approval type confirms at once on approval, with a ticket', async () => {
    const c = await conference({ free: true });
    const r = await applyAs(c, `free-${tag()}@partner.test`);
    expect(r.status).toBe('confirmed');
    const s = await status(r.registrantId);
    expect(s?.ticket_id).toBeTruthy();
  });

  it('manual approval, then pay: the pay link is idempotent and payment confirms with a named ticket', async () => {
    const c = await conference();
    const email = `pay-${tag()}@example.test`;
    const r = await applyAs(c, email);
    expect(await code(decide(c, r.registrantId, 'approve', viewer()))).toBe('forbidden');
    expect((await decide(c, r.registrantId, 'approve', a.ctx(), 'See you there.')).status).toBe('approved');
    // Deciding again changes nothing (no second email).
    expect(await decide(c, r.registrantId, 'approve')).toMatchObject({ changed: false });
    await drain();
    const approvedMails = mail.sent.filter((m) => m.kind === 'registration.approved' && m.to.email === email);
    expect(approvedMails).toHaveLength(1);
    expect(approvedMails[0]?.params).toMatchObject({ body: 'See you there.' });
    expect(String(approvedMails[0]?.params.url)).toContain(`/registration/${r.token}`);
    const first = await executeCommand(payApprovedCommand, { token: r.token }, anon(), ports);
    expect(first).toMatchObject({ reused: false, totalMinor: expect.any(Number) });
    const second = await executeCommand(payApprovedCommand, { token: r.token }, anon(), ports);
    expect(second).toMatchObject({ orderId: first.orderId, reused: true });
    expect(await ordersOf(email)).toBe(1);
    // A forged or other-org link is refused.
    expect(await code(executeCommand(payApprovedCommand, { token: `${r.token}x` }, anon(), ports))).toBe(
      'not_found',
    );
    expect(await code(executeCommand(payApprovedCommand, { token: r.token }, anon(b), ports))).toBe('not_found');
    await pay(first.orderId, first.totalMinor);
    const s = await status(r.registrantId);
    expect(s).toMatchObject({ status: 'confirmed', order_id: first.orderId });
    const holder = await withTenant(sys(), async (tx) => {
      const [t] = await tx.execute<{ holder_email: string }>(
        sql`select holder_email from ticketing.tickets where id = ${s?.ticket_id}`,
      );
      return t?.holder_email;
    });
    expect(holder).toBe(email);
    expect(await code(executeCommand(payApprovedCommand, { token: r.token }, anon(), ports))).toBe(
      'invalid_state:already_confirmed',
    );
    const view = await publicRegistrant(a.org.id, r.token);
    expect(view).toMatchObject({ status: 'confirmed', typeName: 'Applicants' });
  });

  it('an approved applicant whose order lapses keeps the approval and may pay again', async () => {
    const c = await conference();
    const r = await applyAs(c, `lapse-${tag()}@example.test`);
    await decide(c, r.registrantId, 'approve');
    const first = await executeCommand(payApprovedCommand, { token: r.token }, anon(), ports);
    await executeCommand(expireOrdersCommand, {}, { ...sys(), now: new Date(Date.now() + 2 * HOUR) }, ports);
    await drain();
    expect(await status(r.registrantId)).toMatchObject({ status: 'approved', order_id: null });
    const again = await executeCommand(payApprovedCommand, { token: r.token }, anon(), ports);
    expect(again.orderId).not.toBe(first.orderId);
  });

  it('deny with a reason (typed or from a template): emailed, never charged, the pay link refuses', async () => {
    const c = await conference();
    const email = `deny-${tag()}@example.test`;
    const r = await applyAs(c, email);
    const tpl = await executeCommand(
      saveReasonTemplateCommand,
      { eventId: c.eventId, decision: 'deny', label: 'Full', body: 'We are full this year.' },
      a.ctx(),
      ports,
    );
    expect(
      await executeCommand(
        decideRegistrantCommand,
        { eventId: c.eventId, registrantId: r.registrantId, decision: 'deny', templateId: tpl.id },
        a.ctx(),
        ports,
      ),
    ).toMatchObject({ status: 'denied', changed: true });
    await drain();
    const denied = mail.sent.filter((m) => m.kind === 'registration.denied' && m.to.email === email);
    expect(denied).toHaveLength(1);
    expect(denied[0]?.params.body).toBe('We are full this year.');
    expect(await code(executeCommand(payApprovedCommand, { token: r.token }, anon(), ports))).toBe(
      'forbidden:not_approved',
    );
    expect(await ordersOf(email)).toBe(0);
    expect(await publicRegistrant(a.org.id, r.token)).toMatchObject({
      status: 'denied',
      reason: 'We are full this year.',
    });
    // A template of the other decision is refused; templates can be removed (not by viewers).
    expect(
      await code(
        executeCommand(
          decideRegistrantCommand,
          { eventId: c.eventId, registrantId: (await applyAs(c, `t-${tag()}@example.test`)).registrantId, decision: 'approve', templateId: tpl.id },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('validation_failed');
    expect(
      await code(executeCommand(removeReasonTemplateCommand, { eventId: c.eventId, templateId: tpl.id }, viewer(), ports)),
    ).toBe('forbidden');
    await executeCommand(removeReasonTemplateCommand, { eventId: c.eventId, templateId: tpl.id }, a.ctx(), ports);
  });

  it('capacity per type holds under concurrent approvals', async () => {
    const c = await conference({ capacity: 3 });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await applyAs(c, `cap${i}-${tag()}@example.test`)).registrantId);
    const results = await Promise.all(ids.map((id) => code(decide(c, id, 'approve'))));
    expect(results.filter((r) => r === 'ok')).toHaveLength(3);
    expect(results.filter((r) => r === 'conflict:type_full')).toHaveLength(3);
    // Approved places are kept: the public sees the type full; the floor counts them.
    const setup = await executeQuery(registrationSetupQuery, { eventId: c.eventId }, a.ctx(), ports);
    expect(setup.types.find((t) => t.id === c.apply)).toMatchObject({ approved: 3, approval: 'manual' });
    const pub = await publicRegistration(a.org.id, c.eventId, { email: 'x@example.test' });
    expect(pub.types.find((t) => t.id === c.apply)?.full).toBe(true);
    // Denying an approved one frees its place for the next approval.
    const approved = [];
    for (const id of ids) if ((await status(id))?.status === 'approved') approved.push(id);
    await decide(c, approved[0] as string, 'deny');
    const pending = [];
    for (const id of ids) if ((await status(id))?.status === 'pending') pending.push(id);
    expect(await code(decide(c, pending[0] as string, 'approve'))).toBe('ok');
    expect(await code(decide(c, pending[1] as string, 'approve'))).toBe('conflict:type_full');
  });

  it('queue filters, counts and search; viewers read; tenant isolation', async () => {
    const c = await conference();
    const who = tag();
    const p = await applyAs(c, `queue-${who}@example.test`);
    await applyAs(c, `queue2-${who}@partner.test`);
    const q = await executeQuery(registrationQueueQuery, { eventId: c.eventId }, viewer(), ports);
    expect(q.rows.map((r) => r.id)).toContain(p.registrantId);
    expect(q.counts).toMatchObject({ pending: 1, approved: 1 });
    const searched = await executeQuery(
      registrationQueueQuery,
      { eventId: c.eventId, status: 'all', search: `queue2-${who}` },
      a.ctx(),
      ports,
    );
    expect(searched.rows).toHaveLength(1);
    expect(searched.rows[0]?.status).toBe('approved');
    // Org b sees nothing of org a's registrants.
    expect(
      await code(executeQuery(registrantDetailQuery, { eventId: c.eventId, registrantId: p.registrantId }, b.ctx(), ports)),
    ).toBe('not_found');
    expect(
      (await executeQuery(registrationQueueQuery, { eventId: c.eventId, status: 'all' }, b.ctx(), ports)).total,
    ).toBe(0);
    expect(await code(publicRegistrant(b.org.id, p.token))).toBe('not_found');
    expect(await code(decide(c, p.registrantId, 'approve', b.ctx()))).toBe('not_found');
  });
});

describe('bulk approve/deny (M5.1c)', () => {
  it('approves 500 as one resumable operation: killed mid-chunk, resumed, each decided and emailed once', async () => {
    const c = await conference();
    const run = tag();
    // 500 pending applications (inserted directly: applying is covered above).
    await withTenant(sys(), (tx) =>
      tx.execute(sql`insert into registration.registrants
        (org_id, event_id, registration_type_id, admission_item_id, status, name, email)
        select ${a.org.id}, ${c.eventId}, ${c.apply}, ${c.fullPass}, 'pending', 'Bulk ' || g, 'bulk' || g || '-' || ${run} || '@example.test'
        from generate_series(1, 500) g`),
    );
    expect(
      await code(
        executeCommand(
          registrationDecideBulk.start,
          { eventId: c.eventId, selection: { filter: { status: 'pending' } }, params: { decision: 'approve' } },
          viewer(),
          ports,
        ),
      ),
    ).toBe('forbidden');
    const op = await executeCommand(
      registrationDecideBulk.start,
      {
        eventId: c.eventId,
        selection: { filter: { status: 'pending', registrationTypeId: c.apply } },
        params: { decision: 'approve', reason: 'Welcome aboard.' },
      },
      a.ctx(),
      ports,
    );
    expect(op.total).toBe(500);
    // One chunk, then the process dies in the middle of the next one (its decisions roll back).
    const step = bulkStepCommand([registrationDecideAction]);
    await executeCommand(step, { operationId: op.operationId }, sys(), ports);
    const killer = bulkStepCommand([
      {
        ...registrationDecideAction,
        run: async (...args: Parameters<typeof registrationDecideAction.run>) => {
          await registrationDecideAction.run(...args);
          throw new Error('killed');
        },
      },
    ]);
    await expect(executeCommand(killer, { operationId: op.operationId }, sys(), ports)).rejects.toThrow('killed');
    let s = await executeQuery(registrationDecideBulk.status, { operationId: op.operationId }, a.ctx(), ports);
    expect(s).toMatchObject({ status: 'running', processed: 50, succeeded: 50 });
    const approvedNow = await withTenant(sys(), async (tx) => {
      const [r] = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from registration.registrants where event_id = ${c.eventId} and status = 'approved'`,
      );
      return r?.n;
    });
    expect(approvedNow).toBe(50);
    // The worker resumes it where it stopped.
    let guard = 0;
    while (s.status === 'running' && guard++ < 50) {
      await runBulk(a.org.id, op.operationId, 10_000);
      s = await executeQuery(registrationDecideBulk.status, { operationId: op.operationId }, a.ctx(), ports);
    }
    expect(s).toMatchObject({ status: 'done', processed: 500, succeeded: 500, failed: 0 });
    const counts = await withTenant(sys(), async (tx) => {
      const [r] = await tx.execute<{ approved: number; events: number }>(sql`select
        (select count(*)::int from registration.registrants where event_id = ${c.eventId} and status = 'approved') as approved,
        (select count(*)::int from platform.domain_events e where e.type = 'registration.registrant.approved'
           and e.aggregate_id in (select id::text from registration.registrants where event_id = ${c.eventId})) as events`);
      return r;
    });
    expect(counts).toMatchObject({ approved: 500, events: 500 });
    // Replaying the whole selection (safe retry) changes nothing and sends nothing.
    const replay = await executeCommand(
      registrationDecideBulk.start,
      {
        eventId: c.eventId,
        selection: { filter: { status: 'approved', registrationTypeId: c.apply } },
        params: { decision: 'approve' },
      },
      a.ctx(),
      ports,
    );
    await runBulk(a.org.id, replay.operationId, 20_000);
    const after = await withTenant(sys(), async (tx) => {
      const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from platform.domain_events e
        where e.type = 'registration.registrant.approved'
          and e.aggregate_id in (select id::text from registration.registrants where event_id = ${c.eventId})`);
      return r?.n;
    });
    expect(after).toBe(500);
  }, 120_000);

  it('bulk deny with a reason; a registrant that no longer fits fails alone with its code', async () => {
    const c = await conference({ capacity: 1 });
    const one = await applyAs(c, `b1-${tag()}@example.test`);
    const two = await applyAs(c, `b2-${tag()}@example.test`);
    const op = await executeCommand(
      registrationDecideBulk.start,
      { eventId: c.eventId, selection: { ids: [one.registrantId, two.registrantId] }, params: { decision: 'approve' } },
      a.ctx(),
      ports,
    );
    await runBulk(a.org.id, op.operationId);
    const s = await executeQuery(registrationDecideBulk.status, { operationId: op.operationId }, a.ctx(), ports);
    expect(s).toMatchObject({ status: 'done', succeeded: 1, failed: 1 });
    expect(s.failures[0]?.code).toBe('type_full');
    const deny = await executeCommand(
      registrationDecideBulk.start,
      {
        eventId: c.eventId,
        selection: { ids: [one.registrantId, two.registrantId] },
        params: { decision: 'deny', reason: 'Sorry.' },
      },
      a.ctx(),
      ports,
    );
    await runBulk(a.org.id, deny.operationId);
    expect((await status(one.registrantId))?.status).toBe('denied');
    expect((await status(two.registrantId))?.status).toBe('denied');
    // Ids of another event are refused at start.
    const other = await conference();
    expect(
      await code(
        executeCommand(
          registrationDecideBulk.start,
          { eventId: other.eventId, selection: { ids: [one.registrantId] }, params: { decision: 'approve' } },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('not_found');
  });
});

describe('group registration and substitution (M5.1c)', () => {
  it('one payer, three named registrants of two types; paid; one substituted keeps exactly one valid credential', async () => {
    const c = await conference();
    const t = tag();
    const people = [
      { name: 'Ada One', email: `ada-${t}@example.test`, registrationTypeId: c.member, admissionItemId: c.fullPass, addOnItemIds: [c.dinner] },
      { name: 'Bo Two', email: `bo-${t}@example.test`, registrationTypeId: c.member, admissionItemId: c.fullPass },
      { name: 'Cy Three', email: `cy-${t}@uni.test`, registrationTypeId: c.student, admissionItemId: c.fullPass },
    ];
    // A student type needs the student's own address at its domain.
    expect(
      await code(
        executeCommand(
          startGroupCommand,
          {
            eventId: c.eventId,
            buyer: { name: 'Payer', email: `payer-${t}@example.test` },
            people: [...people.slice(0, 2), { ...people[2], email: `cy-${t}@example.test` }],
          },
          anon(),
          ports,
        ),
      ),
    ).toBe('forbidden:domain_not_allowed');
    expect(
      await code(
        executeCommand(
          startGroupCommand,
          { eventId: c.eventId, buyer: { name: 'Payer', email: `payer-${t}@example.test` }, people: [people[0], people[0]] },
          anon(),
          ports,
        ),
      ),
    ).toBe('validation_failed:duplicate_email');
    // An approval type can't be bought as part of a group.
    expect(
      await code(
        executeCommand(
          startGroupCommand,
          {
            eventId: c.eventId,
            buyer: { name: 'Payer', email: `payer-${t}@example.test` },
            people: [{ ...people[1], registrationTypeId: c.apply }],
          },
          anon(),
          ports,
        ),
      ),
    ).toBe('forbidden:approval_required');
    const g = await executeCommand(
      startGroupCommand,
      { eventId: c.eventId, buyer: { name: 'Payer', email: `payer-${t}@example.test` }, people },
      anon(),
      ports,
    );
    expect(g.registrantIds).toHaveLength(3);
    expect(g.order.totalMinor).toBeGreaterThan(0);
    const setup = await executeQuery(registrationSetupQuery, { eventId: c.eventId }, a.ctx(), ports);
    expect(setup.types.find((x) => x.id === c.member)?.quantityHeld).toBe(2);
    expect(setup.types.find((x) => x.id === c.student)?.quantityHeld).toBe(1);
    await pay(g.order.id, g.order.totalMinor);
    const after = await executeQuery(registrationSetupQuery, { eventId: c.eventId }, a.ctx(), ports);
    expect(after.types.find((x) => x.id === c.member)).toMatchObject({ quantityHeld: 0, quantitySold: 2 });
    const holders = await withTenant(sys(), (tx) =>
      tx.execute<{ name: string; email: string; holder_name: string; ticket_id: string }>(sql`
        select r.name, r.email, t.holder_name, r.ticket_id from registration.registrants r
        join ticketing.tickets t on t.id = r.ticket_id
        where r.order_id = ${g.order.id} and r.status = 'confirmed' order by r.created_at`),
    );
    expect(holders.map((h) => h.holder_name).sort()).toEqual(['Ada One', 'Bo Two', 'Cy Three']);
    const group = await publicGroup(a.org.id, g.groupToken);
    expect(group.members).toHaveLength(3);
    expect(group.members.every((m) => m.canSubstitute)).toBe(true);
    // The payer replaces Bo: the ticket is reissued to the new person; the old code stops.
    const bo = group.members.find((m) => m.name === 'Bo Two');
    const boTicket = holders.find((h) => h.name === 'Bo Two')?.ticket_id as string;
    const sub = await executeCommand(
      substituteByPayerCommand,
      { token: g.groupToken, registrantId: bo?.id as string, name: 'Di Four', email: `di-${t}@example.test` },
      anon(),
      ports,
    );
    expect(sub).toMatchObject({ ticketId: boTicket, rev: 1 });
    const codes = await withTenant(sys(), async (tx) => {
      const [r] = await tx.execute<{ active: number; total: number; holder: string }>(sql`
        select count(*) filter (where b.active)::int as active, count(*)::int as total,
          (select holder_name from ticketing.tickets where id = ${boTicket}) as holder
        from ticketing.ticket_barcodes b where b.ticket_id = ${boTicket} and b.format = 'yy1'`);
      return r;
    });
    expect(codes).toMatchObject({ active: 1, total: 2, holder: 'Di Four' });
    const detail = await executeQuery(
      registrantDetailQuery,
      { eventId: c.eventId, registrantId: bo?.id as string },
      a.ctx(),
      ports,
    );
    expect(detail).toMatchObject({ name: 'Di Four', substitutions: 1 });
    expect(detail.group).toHaveLength(2);
    // Audited.
    const audit = await withTenant(sys(), async (tx) => {
      const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from platform.audit_events
        where action = 'registration.substitute' and target_id = ${bo?.id as string}`);
      return r?.n;
    });
    expect(audit).toBe(1);
    // Another order's link, a forged link, or the student type's domain rule refuse.
    expect(
      await code(
        executeCommand(
          substituteByPayerCommand,
          { token: groupToken(uuidv7()), registrantId: bo?.id as string, name: 'X', email: 'x@example.test' },
          anon(),
          ports,
        ),
      ),
    ).toBe('not_found');
    const cy = group.members.find((m) => m.name === 'Cy Three');
    expect(
      await code(
        executeCommand(
          substituteByPayerCommand,
          { token: g.groupToken, registrantId: cy?.id as string, name: 'Ed', email: `ed-${t}@example.test` },
          anon(),
          ports,
        ),
      ),
    ).toBe('forbidden:domain_not_allowed');
    // After the cut-off (24 h before the start) substitution closes, for the organizer too.
    const late = new Date(new Date(STARTS).getTime() - 2 * HOUR);
    expect(
      await code(
        executeCommand(
          substituteRegistrantCommand,
          { eventId: c.eventId, registrantId: cy?.id as string, name: 'Ed', email: `ed-${t}@uni.test` },
          a.ctx({ now: late }),
          ports,
        ),
      ),
    ).toBe('invalid_state:substitution_closed');
    expect(
      await code(
        executeCommand(
          substituteRegistrantCommand,
          { eventId: c.eventId, registrantId: cy?.id as string, name: 'Ed', email: `ed-${t}@uni.test` },
          viewer(),
          ports,
        ),
      ),
    ).toBe('forbidden');
    expect(
      await executeCommand(
        substituteRegistrantCommand,
        { eventId: c.eventId, registrantId: cy?.id as string, name: 'Ed Five', email: `ed-${t}@uni.test` },
        a.ctx(),
        ports,
      ),
    ).toMatchObject({ rev: 1 });
  });

  it('an unpaid group lapses: its registrants are cancelled and the places come back', async () => {
    const c = await conference();
    const t = tag();
    const g = await executeCommand(
      startGroupCommand,
      {
        eventId: c.eventId,
        buyer: { name: 'Payer', email: `lapse-${t}@example.test` },
        people: [
          { name: 'One', email: `one-${t}@example.test`, registrationTypeId: c.member, admissionItemId: c.fullPass },
          { name: 'Two', email: `two-${t}@uni.test`, registrationTypeId: c.student, admissionItemId: c.fullPass },
        ],
      },
      anon(),
      ports,
    );
    await executeCommand(expireOrdersCommand, {}, { ...sys(), now: new Date(Date.now() + 2 * HOUR) }, ports);
    await drain();
    for (const id of g.registrantIds) expect((await status(id))?.status).toBe('cancelled');
    const setup = await executeQuery(registrationSetupQuery, { eventId: c.eventId }, a.ctx(), ports);
    expect(setup.types.find((x) => x.id === c.student)).toMatchObject({ quantityHeld: 0, quantitySold: 0 });
  });
});

describe('+1 guest types (M5.1c)', () => {
  it('a confirmed host adds a guest of a guest type, up to its allowance; guest types are not sold directly', async () => {
    const c = await conference();
    const guestType = await executeCommand(
      createRegistrationTypeCommand,
      { eventId: c.eventId, name: 'Guest' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setCellCommand,
      { eventId: c.eventId, registrationTypeId: guestType.id, admissionItemId: c.fullPass, priceMinor: 0 },
      a.ctx(),
      ports,
    );
    // A guest type has no approval of its own.
    expect(
      await code(
        executeCommand(
          setTypeRulesCommand,
          { eventId: c.eventId, registrationTypeId: guestType.id, approval: 'manual', kind: 'guest' },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('validation_failed:guest_no_approval');
    await executeCommand(
      setTypeRulesCommand,
      { eventId: c.eventId, registrationTypeId: guestType.id, approval: 'none', kind: 'guest', guestsPerHost: 1 },
      a.ctx(),
      ports,
    );
    const t = tag();
    expect(
      await code(
        executeCommand(
          startRegistrationCommand,
          {
            eventId: c.eventId,
            registrationTypeId: guestType.id,
            itemIds: [c.fullPass],
            buyer: { email: `direct-${t}@example.test`, name: 'Direct' },
          },
          anon(),
          ports,
        ),
      ),
    ).toBe('forbidden:guest_type');
    expect((await publicRegistration(a.org.id, c.eventId)).types.some((x) => x.id === guestType.id)).toBe(false);
    // The host registers (free approval type → confirmed) and gets their own link.
    await executeCommand(
      setCellCommand,
      { eventId: c.eventId, registrationTypeId: c.apply, admissionItemId: c.fullPass, priceMinor: 0 },
      a.ctx(),
      ports,
    );
    const host = await applyAs(c, `host-${t}@partner.test`);
    expect(host.status).toBe('confirmed');
    const before = await publicRegistrant(a.org.id, host.token);
    expect(before).toMatchObject({ guestsLeft: 1 });
    expect(before.guestTypes.map((g) => g.id)).toEqual([guestType.id]);
    // A guest of a non-guest type is refused; the host can't be their own guest.
    expect(
      await code(
        executeCommand(
          addGuestCommand,
          { token: host.token, registrationTypeId: c.member, admissionItemId: c.fullPass, name: 'G', email: `g-${t}@example.test` },
          anon(),
          ports,
        ),
      ),
    ).toBe('forbidden:not_guest_type');
    const guest = await executeCommand(
      addGuestCommand,
      { token: host.token, registrationTypeId: guestType.id, admissionItemId: c.fullPass, name: 'Plus One', email: `plus-${t}@example.test` },
      anon(),
      ports,
    );
    expect(guest.order.status).toBe('paid');
    expect(await status(guest.registrantId)).toMatchObject({ status: 'confirmed' });
    expect(
      await code(
        executeCommand(
          addGuestCommand,
          { token: host.token, registrationTypeId: guestType.id, admissionItemId: c.fullPass, name: 'Plus Two', email: `plus2-${t}@example.test` },
          anon(),
          ports,
        ),
      ),
    ).toBe('invalid_state:guest_limit');
    const detail = await executeQuery(
      registrantDetailQuery,
      { eventId: c.eventId, registrantId: guest.registrantId },
      a.ctx(),
      ports,
    );
    expect(detail.hostName).toBe(`Applicant host-${t}`);
    const hostDetail = await executeQuery(
      registrantDetailQuery,
      { eventId: c.eventId, registrantId: host.registrantId },
      a.ctx(),
      ports,
    );
    expect(hostDetail.guests.map((g) => g.name)).toEqual(['Plus One']);
    // A pending applicant can't bring a guest.
    await executeCommand(
      setCellCommand,
      { eventId: c.eventId, registrationTypeId: c.apply, admissionItemId: c.fullPass, priceMinor: 40000 },
      a.ctx(),
      ports,
    );
    const pending = await applyAs(c, `pend-${t}@example.test`);
    expect(
      await code(
        executeCommand(
          addGuestCommand,
          { token: pending.token, registrationTypeId: guestType.id, admissionItemId: c.fullPass, name: 'G', email: `g2-${t}@example.test` },
          anon(),
          ports,
        ),
      ),
    ).toBe('forbidden:host_not_confirmed');
    expect(registrantToken(host.registrantId)).toBe(host.token);
  });
});
