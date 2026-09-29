import { setFeeOverrideCommand } from '@yayatoh/billing';
import { scanTicketCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyDisputeEventCommand,
  applyProviderEventCommand,
  archiveSupportMacroCommand,
  attachPaymentCommand,
  creditNoteMailer,
  creditNotesQuery,
  creditNoteTotalsQuery,
  expireOrdersCommand,
  issueCreditNoteCommand,
  previewSupportMacroQuery,
  runSupportMacroCommand,
  saveSupportMacroCommand,
  setRefundPolicyCommand,
  startCheckoutCommand,
  supportMacrosQuery,
  supportReplyMailer,
} from '@yayatoh/orders';
import { alertDisputeDeadlinesCommand, disputeDeadlineNotifier } from '@yayatoh/payments';
import { consumeEvent, eventKey, memoryNotifier, recentEventsTx, type Subscriber } from '@yayatoh/platform';
import { disputeEvidenceQuery, disputeQueueQuery, orderTimelineQuery } from '@yayatoh/reports';
import { addMemberCommand } from '@yayatoh/tenancy';
import {
  cancelHolderTransferCommand,
  cancelTransferCommand,
  claimContext,
  claimDetailsQuery,
  claimTicketCommand,
  createTicketTypeCommand,
  fakeWalletPassProvider,
  giveTicketCommand,
  holderTicketsQuery,
  orderTransfersQuery,
  orderWalletPassesQuery,
  requestHolderLinkCommand,
  startHolderTransferCommand,
  startTransferCommand,
  transferMailer,
  updateTicketTypeCommand,
  walletPassSync,
} from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M3.10c support tools: ticket transfers with a claim step (void and reissue exactly once, wallet
 * passes, both parties told), credit notes (numbering, idempotency, store credit at checkout),
 * the dispute queue with deadline alerts and the evidence packet, support macros; permissions and
 * isolation.
 */
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let otherEventId: string;
let typeId: string;
let otherTypeId: string;
let financeId: string;
let managerId: string;
const STARTS = '2027-06-12T23:00:00Z';

interface Bought {
  orderId: string;
  token: string;
  ticketIds: string[];
  total: number;
  pi: string;
}

const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>, orgId = a.org.id) =>
  withTenant(systemCtx(orgId), (tx) => tx.execute<T>(query));
const publicCtx = (now?: Date) => createCtx({ orgId: a.org.id, ...(now ? { now } : {}) });
const viewer = () => userCtx(a.viewerId, a.org.id);
const finance = (over: Partial<Ctx> = {}) => userCtx(financeId, a.org.id, over);
const manager = (over: Partial<Ctx> = {}) => userCtx(managerId, a.org.id, over);
const key = () => `k-${uuidv7()}`;
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err as { code: string; details?: Record<string, unknown> };
  }
  throw new Error('expected a refusal');
};

async function buy(
  email: string,
  quantity: number,
  opts: { event?: string; type?: string; code?: string; pay?: boolean } = {},
): Promise<Bought> {
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId: opts.event ?? eventId,
      items: [{ ticketTypeId: opts.type ?? typeId, quantity }],
      buyer: { email, name: `Buyer ${email.split('@')[0]}` },
      ...(opts.code ? { promoCode: opts.code } : {}),
    },
    publicCtx(),
    ports,
  );
  const pi = `fakepi_st_${c.order.id}`;
  if (opts.pay !== false && c.order.status !== 'paid') {
    await executeCommand(
      attachPaymentCommand,
      { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
      publicCtx(),
      ports,
    );
    await executeCommand(
      applyProviderEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_st_${c.order.id}`,
        type: 'payment.succeeded',
        providerPaymentId: pi,
        amountMinor: c.order.totalMinor,
        currency: 'USD',
        orgId: a.org.id,
        orderId: c.order.id,
      },
      systemCtx(a.org.id),
      ports,
    );
  }
  const ticketIds = (
    await q<{ id: string }>(
      sql`select id from ticketing.tickets where order_id = ${c.order.id} order by serial`,
    )
  ).map((r) => r.id);
  return { orderId: c.order.id, token: c.manageToken, ticketIds, total: c.order.totalMinor, pi };
}

async function drain(sub: Subscriber, types: string[]) {
  const events = await withTenant(systemCtx(a.org.id), (tx) =>
    recentEventsTx(tx, a.org.id, types, 3_600_000),
  );
  for (const e of events) if (sub.events.includes(eventKey(e))) await consumeEvent(sub, e);
}

const tokenId = async (token: string) => {
  const c = await claimContext(token);
  if (!c) throw new Error('bad claim token');
  return c.id;
};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  financeId = uuidv7();
  managerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: financeId, role: 'finance' }, a.ctx(), ports);
  await executeCommand(addMemberCommand, { userId: managerId, role: 'manager' }, a.ctx(), ports);
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps: 1000, fixedMinor: 50, reason: 'test fee' },
    systemCtx(a.org.id),
    ports,
  );
  const mk = async (name: string) => {
    const id = (
      await executeCommand(
        createEventCommand,
        { name, timezone: 'America/Chicago', startsAt: STARTS, endsAt: '2027-06-13T04:00:00Z' },
        a.ctx(),
        ports,
      )
    ).id;
    const t = (
      await executeCommand(
        createTicketTypeCommand,
        { eventId: id, name: 'GA', priceMinor: 5000, quantityTotal: 100 },
        a.ctx(),
        ports,
      )
    ).id;
    await executeCommand(transitionEventCommand, { eventId: id, transition: 'publish' }, a.ctx(), ports);
    return { id, t };
  };
  ({ id: eventId, t: typeId } = await mk('Support Night'));
  ({ id: otherEventId, t: otherTypeId } = await mk('Support Encore'));
  await executeCommand(
    setRefundPolicyCommand,
    { eventId, kind: 'until', daysBefore: 7, retainedMinor: 100 },
    a.ctx(),
    ports,
  );
});
afterAll(closePools);

describe('ticket transfers with a claim step (M3.10c)', () => {
  let order: Bought;
  let token: string;
  let transferId: string;
  let oldCode: string;

  it('an organizer starts a transfer; the ticket stays with its holder until claimed', async () => {
    order = await buy('holder@example.test', 2);
    const [code] = await q<{ payload: string }>(
      sql`select payload from ticketing.ticket_barcodes where ticket_id = ${order.ticketIds[0]} and active`,
    );
    oldCode = code?.payload ?? '';
    const started = await executeCommand(
      startTransferCommand,
      {
        orderId: order.orderId,
        ticketId: order.ticketIds[0],
        toName: 'Noor Haddad',
        toEmail: 'Noor@Example.test',
      },
      manager(),
      ports,
    );
    expect(started.feeMinor).toBe(0);
    token = started.token;
    transferId = started.transferId;
    const [t] = await executeQuery(orderTransfersQuery, { orderId: order.orderId }, viewer(), ports);
    expect(t).toMatchObject({
      state: 'pending',
      initiatedBy: 'organizer',
      fromEmail: 'holder@example.test',
      toName: 'Noor Haddad',
      toEmail: 'noor@example.test',
    });
    const [holder] = await q<{ holder_email: string }>(
      sql`select holder_email from ticketing.tickets where id = ${order.ticketIds[0]}`,
    );
    expect(holder?.holder_email).toBe('holder@example.test');
    const details = await executeQuery(
      claimDetailsQuery,
      { claimId: await tokenId(token) },
      publicCtx(),
      ports,
    );
    expect(details).toMatchObject({
      state: 'open',
      transfer: { fromName: 'Buyer holder', toName: 'Noor Haddad' },
    });
  });

  it('viewers and other orgs cannot start or cancel transfers', async () => {
    expect(
      await refusal(
        executeCommand(
          startTransferCommand,
          { orderId: order.orderId, ticketId: order.ticketIds[1], toName: 'X', toEmail: 'x@example.test' },
          viewer(),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await refusal(executeCommand(cancelTransferCommand, { transferId }, viewer(), ports)),
    ).toMatchObject({
      code: 'forbidden',
    });
    expect(
      await refusal(
        executeCommand(
          startTransferCommand,
          { orderId: order.orderId, ticketId: order.ticketIds[1], toName: 'X', toEmail: 'x@example.test' },
          b.ctx(),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'not_found' });
    expect(
      await refusal(executeCommand(cancelTransferCommand, { transferId }, b.ctx(), ports)),
    ).toMatchObject({
      code: 'not_found',
    });
    expect(await executeQuery(orderTransfersQuery, { orderId: order.orderId }, b.ctx(), ports)).toEqual([]);
  });

  it('the recipient claims with the address it was sent to: the old code is void, the ticket reissued once', async () => {
    const claimId = await tokenId(token);
    expect(
      await refusal(
        executeCommand(
          claimTicketCommand,
          { claimId, name: 'Noor', email: 'someone@example.test' },
          publicCtx(),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'validation_failed', details: { reason: 'email_mismatch' } });
    await executeCommand(
      claimTicketCommand,
      { claimId, name: 'Noor Haddad', email: 'noor@example.test' },
      publicCtx(),
      ports,
    );
    // A second claim (a double click, a replayed link) is refused and changes nothing.
    expect(
      await refusal(
        executeCommand(
          claimTicketCommand,
          { claimId, name: 'Noor Haddad', email: 'noor@example.test' },
          publicCtx(),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'invalid_state', details: { state: 'claimed' } });
    const [ticket] = await q<{ holder_name: string; holder_email: string; rev: number; status: string }>(
      sql`select holder_name, holder_email, rev, status from ticketing.tickets where id = ${order.ticketIds[0]}`,
    );
    expect(ticket).toEqual({
      holder_name: 'Noor Haddad',
      holder_email: 'noor@example.test',
      rev: 1,
      status: 'active',
    });
    const codes = await q<{ rev: number; active: boolean }>(
      sql`select rev, active from ticketing.ticket_barcodes where ticket_id = ${order.ticketIds[0]} order by rev`,
    );
    expect(codes).toEqual([
      { rev: 0, active: false },
      { rev: 1, active: true },
    ]);
    const [t] = await executeQuery(orderTransfersQuery, { orderId: order.orderId }, a.ctx(), ports);
    expect(t).toMatchObject({ id: transferId, state: 'claimed' });
    const [claimed] = await q<{ n: number }>(
      sql`select count(*)::int as n from platform.domain_events where type = 'ticket.transferred' and aggregate_id = ${order.ticketIds[0]}`,
    );
    expect(claimed?.n).toBe(1);
    // Wallet: the new holder's pass for the new code (the provider hears after commit).
    expect(await executeQuery(orderWalletPassesQuery, { orderId: order.orderId }, a.ctx(), ports)).toEqual([
      { ticketId: order.ticketIds[0], rev: 1, status: 'active', pushed: false },
    ]);
  });

  it('the old QR is refused at the door; the new one admits', async () => {
    const door = a.ctx({ now: new Date('2027-06-12T23:30:00Z') });
    const old = await executeCommand(scanTicketCommand, { eventId, code: oldCode }, door, ports);
    expect(old.result).not.toBe('admitted');
    const [code] = await q<{ payload: string }>(
      sql`select payload from ticketing.ticket_barcodes where ticket_id = ${order.ticketIds[0]} and active`,
    );
    const fresh = await executeCommand(
      scanTicketCommand,
      { eventId, code: code?.payload ?? '' },
      door,
      ports,
    );
    expect(fresh.result).toBe('admitted');
  });

  it('both parties are told, once each; the wallet provider voids and issues', async () => {
    const memory = memoryNotifier();
    const sub = transferMailer({ notifier: memory.notifier, appOrigin: 'https://app.test' });
    await drain(sub, ['ticket.transfer_offered', 'ticket.transferred']);
    await drain(sub, ['ticket.transfer_offered', 'ticket.transferred']);
    const mine = memory.sent.filter((m) => m.dedupeKey?.endsWith(transferId));
    expect(mine.map((m) => [m.kind, m.to.email]).sort()).toEqual([
      ['ticketing.transfer-completed', 'holder@example.test'],
      ['ticketing.transfer-received', 'noor@example.test'],
    ]);
    expect(mine.find((m) => m.kind === 'ticketing.transfer-received')?.params.url).toMatch(
      /^https:\/\/app\.test\/my-tickets\//,
    );
    const wallet = fakeWalletPassProvider();
    const sync = walletPassSync({ provider: wallet });
    await drain(sync, ['ticket.transferred']);
    await drain(sync, ['ticket.transferred']);
    expect(wallet.pushes.filter((p) => p.serial.includes(order.ticketIds[0] ?? '-'))).toEqual([
      { op: 'upsert', serial: `yy-${order.ticketIds[0]}-1`, holderName: 'Noor Haddad' },
    ]);
    expect(
      (await executeQuery(orderWalletPassesQuery, { orderId: order.orderId }, a.ctx(), ports))[0]?.pushed,
    ).toBe(true);
  });

  it('a second transfer voids the previous pass; the offer email reaches the recipient', async () => {
    const again = await executeCommand(
      startTransferCommand,
      {
        orderId: order.orderId,
        ticketId: order.ticketIds[0],
        toName: 'Sam Lee',
        toEmail: 'sam@example.test',
      },
      a.ctx(),
      ports,
    );
    const memory = memoryNotifier();
    await drain(transferMailer({ notifier: memory.notifier, appOrigin: 'https://app.test' }), [
      'ticket.transfer_offered',
    ]);
    const offer = memory.sent.find((m) => m.dedupeKey === `transfer-offered:${again.transferId}`);
    expect(offer).toMatchObject({
      kind: 'ticketing.transfer-offered',
      to: { email: 'sam@example.test' },
      params: { fromName: 'Noor Haddad', name: 'Sam Lee' },
    });
    await executeCommand(
      claimTicketCommand,
      { claimId: await tokenId(again.token), name: 'Sam Lee', email: 'sam@example.test' },
      publicCtx(),
      ports,
    );
    const passes = await executeQuery(orderWalletPassesQuery, { orderId: order.orderId }, a.ctx(), ports);
    expect(passes.map((p) => [p.rev, p.status])).toEqual([
      [1, 'voided'],
      [2, 'active'],
    ]);
  });

  it('cancelled before the claim: the link stops working; an expired link is refused', async () => {
    const t = await executeCommand(
      startTransferCommand,
      {
        orderId: order.orderId,
        ticketId: order.ticketIds[1],
        toName: 'Late Friend',
        toEmail: 'late@example.test',
      },
      a.ctx(),
      ports,
    );
    await executeCommand(cancelTransferCommand, { transferId: t.transferId }, manager(), ports);
    expect(
      await refusal(
        executeCommand(
          claimTicketCommand,
          { claimId: await tokenId(t.token), name: 'Late', email: 'late@example.test' },
          publicCtx(),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'invalid_state', details: { state: 'revoked' } });
    expect(
      await refusal(executeCommand(cancelTransferCommand, { transferId: t.transferId }, a.ctx(), ports)),
    ).toMatchObject({ code: 'invalid_state' });
    const t2 = await executeCommand(
      startTransferCommand,
      {
        orderId: order.orderId,
        ticketId: order.ticketIds[1],
        toName: 'Slow Friend',
        toEmail: 'slow@example.test',
      },
      a.ctx(),
      ports,
    );
    const eightDays = new Date(Date.now() + 8 * 86_400_000);
    expect(
      await refusal(
        executeCommand(
          claimTicketCommand,
          { claimId: await tokenId(t2.token), name: 'Slow', email: 'slow@example.test' },
          publicCtx(eightDays),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'invalid_state', details: { state: 'expired' } });
    const states = (await executeQuery(orderTransfersQuery, { orderId: order.orderId }, a.ctx(), ports)).map(
      (x) => x.state,
    );
    expect(states.filter((s) => s === 'cancelled').length).toBeGreaterThanOrEqual(1);
    expect(states).toContain('pending');
    await executeCommand(cancelTransferCommand, { transferId: t2.transferId }, a.ctx(), ports);
  });

  it('holders follow the ticket type rules: allowed, deadline, fee in minor units', async () => {
    const h = await buy('selfserve@example.test', 1);
    await executeCommand(
      requestHolderLinkCommand,
      { eventId, email: 'selfserve@example.test' },
      publicCtx(),
      ports,
    );
    const [link] = await q<{ id: string }>(
      sql`select id from ticketing.holder_links where email_norm = 'selfserve@example.test' order by created_at desc limit 1`,
    );
    const linkId = link?.id ?? '';
    const holderTransfer = (extra: Record<string, unknown> = {}, now?: Date) =>
      executeCommand(
        startHolderTransferCommand,
        { linkId, ticketId: h.ticketIds[0], toName: 'Pal', toEmail: 'pal@example.test', ...extra },
        publicCtx(now),
        ports,
      );
    await executeCommand(
      updateTicketTypeCommand,
      { ticketTypeId: typeId, transfersAllowed: false },
      a.ctx(),
      ports,
    );
    expect(await refusal(holderTransfer())).toMatchObject({
      code: 'invalid_state',
      details: { reason: 'not_allowed' },
    });
    const listed = await executeQuery(holderTicketsQuery, { linkId }, publicCtx(), ports);
    expect(listed.tickets[0]?.transfer).toMatchObject({ allowed: false, reason: 'not_allowed' });
    // Past the cutoff: a year before the start is already behind us.
    await executeCommand(
      updateTicketTypeCommand,
      { ticketTypeId: typeId, transfersAllowed: true, transferCutoffHours: 8760, transferFeeMinor: 350 },
      a.ctx(),
      ports,
    );
    expect(await refusal(holderTransfer())).toMatchObject({
      code: 'invalid_state',
      details: { reason: 'deadline_passed', deadline: '2026-06-12T23:00:00.000Z' },
    });
    await executeCommand(
      updateTicketTypeCommand,
      { ticketTypeId: typeId, transferCutoffHours: 48 },
      a.ctx(),
      ports,
    );
    // A fee must be agreed; an open give-away link cannot dodge it.
    expect(await refusal(holderTransfer())).toMatchObject({
      code: 'validation_failed',
      details: { reason: 'fee_not_accepted' },
    });
    expect(
      await refusal(
        executeCommand(giveTicketCommand, { linkId, ticketId: h.ticketIds[0] }, publicCtx(), ports),
      ),
    ).toMatchObject({ code: 'invalid_state', details: { reason: 'fee_required' } });
    expect(await refusal(holderTransfer({ toEmail: 'selfserve@example.test' }))).toMatchObject({
      details: { reason: 'same_holder' },
    });
    const ok = await holderTransfer({ acceptFee: true });
    expect(ok.feeMinor).toBe(350);
    const [t] = await executeQuery(orderTransfersQuery, { orderId: h.orderId }, a.ctx(), ports);
    expect(t).toMatchObject({ initiatedBy: 'holder', feeMinor: 350, currency: 'USD', state: 'pending' });
    // Only the holder who started it (by their link) can cancel it.
    expect(
      await refusal(
        executeCommand(
          cancelHolderTransferCommand,
          { linkId: uuidv7(), transferId: ok.transferId },
          publicCtx(),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'not_found' });
    await executeCommand(
      cancelHolderTransferCommand,
      { linkId, transferId: ok.transferId },
      publicCtx(),
      ports,
    );
    const after = await executeQuery(holderTicketsQuery, { linkId }, publicCtx(), ports);
    expect(after.tickets[0]?.transfer).toMatchObject({
      allowed: true,
      feeMinor: 350,
      pendingTransferId: null,
    });
    await executeCommand(
      updateTicketTypeCommand,
      { ticketTypeId: typeId, transferCutoffHours: null, transferFeeMinor: 0 },
      a.ctx(),
      ports,
    );
  });
});

describe('credit notes (M3.10c)', () => {
  let order: Bought;
  let code: string;
  let firstNumber: number;

  it('finance issues a partial store credit note: numbered per org, code shown once, idempotent', async () => {
    order = await buy('credit@example.test', 2);
    const k = key();
    const input = {
      orderId: order.orderId,
      kind: 'partial' as const,
      amountMinor: 2000,
      disposition: 'store_credit' as const,
      reason: 'Seats were moved.',
    };
    const note = await executeCommand(issueCreditNoteCommand, input, finance({ idempotencyKey: k }), ports);
    const replay = await executeCommand(issueCreditNoteCommand, input, finance({ idempotencyKey: k }), ports);
    expect(replay).toEqual(note);
    expect(note).toMatchObject({ amountMinor: 2000, balanceMinor: 2000, kind: 'partial', currency: 'USD' });
    expect(note.code).toMatch(/^CR-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(note.label).toBe(`CN-${String(note.number).padStart(5, '0')}`);
    code = note.code ?? '';
    firstNumber = note.number;
    expect(await executeQuery(creditNotesQuery, { orderId: order.orderId }, viewer(), ports)).toHaveLength(1);
    expect(
      await refusal(executeCommand(issueCreditNoteCommand, input, finance({ idempotencyKey: null }), ports)),
    ).toMatchObject({ code: 'validation_failed' });
  });

  it('the rest as a full note (recorded refunded); nothing left after that; the numbers follow on', async () => {
    const full = await executeCommand(
      issueCreditNoteCommand,
      { orderId: order.orderId, kind: 'full', disposition: 'refunded', reason: 'Refunded by bank transfer.' },
      a.ctx({ idempotencyKey: key() }),
      ports,
    );
    expect(full).toMatchObject({
      number: firstNumber + 1,
      amountMinor: order.total - 2000,
      balanceMinor: 0,
      code: null,
    });
    expect(
      await refusal(
        executeCommand(
          issueCreditNoteCommand,
          {
            orderId: order.orderId,
            kind: 'partial',
            amountMinor: 1,
            disposition: 'refunded',
            reason: 'More?',
          },
          a.ctx({ idempotencyKey: key() }),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'invalid_state', details: { reason: 'nothing_to_credit' } });
    const other = await buy('credit2@example.test', 1);
    expect(
      await refusal(
        executeCommand(
          issueCreditNoteCommand,
          {
            orderId: other.orderId,
            kind: 'partial',
            amountMinor: other.total + 1,
            disposition: 'refunded',
            reason: 'Too much',
          },
          a.ctx({ idempotencyKey: key() }),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'validation_failed', details: { reason: 'amount_too_large' } });
  });

  it('only finance roles issue them; other orgs see nothing', async () => {
    const input = {
      orderId: order.orderId,
      kind: 'full' as const,
      disposition: 'refunded' as const,
      reason: 'Nope',
    };
    for (const ctx of [viewer(), manager()])
      expect(
        await refusal(
          executeCommand(issueCreditNoteCommand, input, { ...ctx, idempotencyKey: key() }, ports),
        ),
      ).toMatchObject({ code: 'forbidden' });
    expect(
      await refusal(executeCommand(issueCreditNoteCommand, input, b.ctx({ idempotencyKey: key() }), ports)),
    ).toMatchObject({ code: 'not_found' });
    expect(await executeQuery(creditNotesQuery, { orderId: order.orderId }, b.ctx(), ports)).toEqual([]);
  });

  it('store credit pays part of a later order at the same org, and comes back if that order lapses', async () => {
    const lapsed = await buy('credit@example.test', 1, {
      event: otherEventId,
      type: otherTypeId,
      code,
      pay: false,
    });
    const [line] = await q<{ unit_discount_minor: number; unit_all_in_minor: number }>(
      sql`select unit_discount_minor::int, unit_all_in_minor::int from orders.order_items where order_id = ${lapsed.orderId}`,
    );
    expect(line?.unit_discount_minor).toBe(2000);
    const [bal] = await q<{ balance_minor: number }>(
      sql`select balance_minor::int from orders.credit_notes where code = ${code}`,
    );
    expect(bal?.balance_minor).toBe(0);
    // Spent: the code no longer works.
    expect(
      await refusal(buy('credit@example.test', 1, { event: otherEventId, type: otherTypeId, code })),
    ).toMatchObject({
      details: { reason: 'credit_invalid' },
    });
    await executeCommand(
      expireOrdersCommand,
      {},
      { ...systemCtx(a.org.id), now: new Date(Date.now() + 60 * 60_000) },
      ports,
    );
    const [back] = await q<{ balance_minor: number }>(
      sql`select balance_minor::int from orders.credit_notes where code = ${code}`,
    );
    expect(back?.balance_minor).toBe(2000);
    // Spent for real on a paid order (three tickets: 666 off each, 2 minor units stay on the note).
    const paid = await buy('credit@example.test', 3, {
      event: otherEventId,
      type: otherTypeId,
      code: code.toLowerCase(),
    });
    const [row] = await q<{ discount_minor: number; promo_code: string; status: string }>(
      sql`select discount_minor::int, promo_code, status from orders.orders where id = ${paid.orderId}`,
    );
    expect(row).toMatchObject({
      discount_minor: 1998,
      status: 'paid',
      promo_code: `CN-${String(firstNumber).padStart(5, '0')}`,
    });
    const [left] = await q<{ balance_minor: number }>(
      sql`select balance_minor::int from orders.credit_notes where code = ${code}`,
    );
    expect(left?.balance_minor).toBe(2);
    // Another org's checkout never sees the code.
    await expect(
      executeCommand(
        startCheckoutCommand,
        {
          eventId: b.event.id,
          items: [{ ticketTypeId: uuidv7(), quantity: 1 }],
          buyer: { email: 'credit@example.test', name: 'X' },
          promoCode: code,
        },
        createCtx({ orgId: b.org.id }),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'credit_invalid' } });
    const timeline = await executeQuery(orderTimelineQuery, { orderId: paid.orderId }, a.ctx(), ports);
    expect(timeline.items.find((i) => i.kind === 'credit_applied')).toMatchObject({ amountMinor: 1998 });
    const source = await executeQuery(orderTimelineQuery, { orderId: order.orderId }, a.ctx(), ports);
    expect(source.items.filter((i) => i.kind === 'credit_note_issued').map((i) => i.code)).toEqual([
      'store_credit',
      'refunded',
    ]);
  });

  it('finance totals per currency; the buyer is emailed the code', async () => {
    const totals = await executeQuery(creditNoteTotalsQuery, { eventId }, finance(), ports);
    const usd = totals.find((t) => t.currency === 'USD');
    expect(usd).toMatchObject({ storeCreditMinor: 2000, appliedMinor: 1998, outstandingMinor: 2 });
    expect(await refusal(executeQuery(creditNoteTotalsQuery, {}, viewer(), ports))).toMatchObject({
      code: 'forbidden',
    });
    const memory = memoryNotifier();
    await drain(creditNoteMailer({ notifier: memory.notifier, appOrigin: 'https://app.test' }), [
      'order.credit_note_issued',
    ]);
    const mail = memory.sent.find((m) => m.orderId === order.orderId && m.params.storeCredit === 'yes');
    expect(mail).toMatchObject({
      kind: 'orders.credit-note',
      to: { email: 'credit@example.test' },
      params: { code, amountMinor: 2000, currency: 'USD' },
    });
  });
});

describe('dispute queue, deadline alerts and evidence (M3.10c)', () => {
  let order: Bought;
  let disputeId: string;
  const dispute = (
    type: 'dispute.created' | 'dispute.closed',
    o: Bought,
    id: string,
    due?: string,
    outcome?: 'won' | 'lost',
  ) =>
    executeCommand(
      applyDisputeEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_${type}_${id}`,
        type,
        orgId: a.org.id,
        providerPaymentId: o.pi,
        providerDisputeId: id,
        amountMinor: o.total,
        currency: 'USD',
        reason: 'product_not_received',
        ...(due ? { evidenceDueBy: due } : {}),
        ...(outcome ? { outcome } : {}),
      },
      systemCtx(a.org.id),
      ports,
    );

  it('lists open disputes soonest deadline first, with hours left; closed ones on their own tab', async () => {
    order = await buy('disputed@example.test', 1);
    await executeCommand(
      startTransferCommand,
      { orderId: order.orderId, ticketId: order.ticketIds[0], toName: 'Friend F', toEmail: 'f@example.test' },
      a.ctx(),
      ports,
    );
    const due = new Date(Date.now() + 60 * 3_600_000).toISOString();
    await dispute('dispute.created', order, `dq_${order.orderId}`, due);
    const closed = await buy('closed@example.test', 1);
    await dispute('dispute.created', closed, `dq_${closed.orderId}`);
    await dispute('dispute.closed', closed, `dq_${closed.orderId}`, undefined, 'lost');
    const open = await executeQuery(disputeQueueQuery, { tab: 'open' }, finance(), ports);
    const mine = open.items.find((i) => i.orderId === order.orderId);
    if (!mine) throw new Error('dispute not in the queue');
    disputeId = mine.id;
    expect(mine).toMatchObject({
      status: 'open',
      buyerName: 'Buyer disputed',
      eventName: 'Support Night',
      amountMinor: order.total,
      urgency: 1,
    });
    expect(mine.hoursLeft).toBeGreaterThanOrEqual(59);
    expect(mine.hoursLeft).toBeLessThanOrEqual(60);
    const closedTab = await executeQuery(disputeQueueQuery, { tab: 'closed' }, finance(), ports);
    expect(closedTab.items.find((i) => i.orderId === closed.orderId)?.status).toBe('lost');
    expect(open.counts.dueSoon).toBeGreaterThanOrEqual(1);
    expect(await refusal(executeQuery(disputeQueueQuery, {}, viewer(), ports))).toMatchObject({
      code: 'forbidden',
    });
    const theirs = await executeQuery(disputeQueueQuery, { tab: 'open' }, b.ctx(), ports);
    expect(theirs.items.some((i) => i.orderId === order.orderId)).toBe(false);
  });

  it('raises each deadline alert once: three days, then one day; the finance team is notified', async () => {
    const run = (now = new Date()) =>
      executeCommand(alertDisputeDeadlinesCommand, {}, { ...systemCtx(a.org.id), now }, ports);
    expect((await run()).alerted).toBeGreaterThanOrEqual(1);
    const level = async () =>
      (
        await q<{ l: number }>(
          sql`select deadline_alert_level as l from payments.disputes where id = ${disputeId}`,
        )
      )[0]?.l;
    expect(await level()).toBe(1);
    await run();
    expect(await level()).toBe(1);
    await run(new Date(Date.now() + 40 * 3_600_000));
    expect(await level()).toBe(2);
    await run(new Date(Date.now() + 50 * 3_600_000));
    const events = await q<{ n: number }>(
      sql`select count(*)::int as n from platform.domain_events where type = 'payments.dispute_deadline_approaching' and aggregate_id = ${disputeId}`,
    );
    expect(events[0]?.n).toBe(2);
    expect(await refusal(executeCommand(alertDisputeDeadlinesCommand, {}, a.ctx(), ports))).toMatchObject({
      code: 'forbidden',
    });
    const memory = memoryNotifier();
    await drain(disputeDeadlineNotifier({ notifier: memory.notifier }), [
      'payments.dispute_deadline_approaching',
    ]);
    const mine = memory.members.filter((m) => m.dedupeKey?.startsWith(`dispute-deadline:${disputeId}`));
    expect(mine.map((m) => m.dedupeKey).sort()).toEqual([
      `dispute-deadline:${disputeId}:1`,
      `dispute-deadline:${disputeId}:2`,
    ]);
    expect(mine[0]).toMatchObject({ kind: 'payments.dispute-deadline', href: '/disputes' });
  });

  it('the evidence packet holds the order, tickets, the terms at purchase and transfers', async () => {
    const e = await executeQuery(disputeEvidenceQuery, { disputeId }, finance(), ports);
    expect(e.order.id).toBe(order.orderId);
    expect(e.tickets).toHaveLength(1);
    expect(e.policySnapshot).toEqual({ kind: 'until', daysBefore: 7, retainedMinor: 100 });
    expect(e.transfers).toEqual([
      expect.objectContaining({ fromName: 'Buyer disputed', toName: 'Friend F', state: 'pending' }),
    ]);
    expect(await refusal(executeQuery(disputeEvidenceQuery, { disputeId }, b.ctx(), ports))).toMatchObject({
      code: 'not_found',
    });
  });
});

describe('support macros (M3.10c)', () => {
  let macroId: string;
  let order: Bought;

  it('saves macros with known merge fields only, unique names; viewers cannot', async () => {
    const base = {
      name: 'Resend and note',
      subject: 'Your tickets for {{event_name}}',
      body: 'Hi {{buyer_name}}, we sent your {{ticket_count}} tickets again (order {{order_ref}}).',
      actions: ['resend_tickets', 'email_buyer', 'add_note'] as (
        | 'resend_tickets'
        | 'email_buyer'
        | 'add_note'
      )[],
    };
    expect(
      await refusal(
        executeCommand(saveSupportMacroCommand, { ...base, body: 'Hi {{first_name}}' }, manager(), ports),
      ),
    ).toMatchObject({ code: 'validation_failed', details: { reason: 'unknown_merge_field', field: 'body' } });
    const m = await executeCommand(saveSupportMacroCommand, base, manager(), ports);
    macroId = m.id;
    expect(m.actions).toEqual(['email_buyer', 'add_note', 'resend_tickets']);
    expect(
      await refusal(
        executeCommand(saveSupportMacroCommand, { ...base, name: 'RESEND AND NOTE' }, a.ctx(), ports),
      ),
    ).toMatchObject({ details: { reason: 'name_taken' } });
    expect(await refusal(executeCommand(saveSupportMacroCommand, base, viewer(), ports))).toMatchObject({
      code: 'forbidden',
    });
    expect(await refusal(executeQuery(supportMacrosQuery, {}, viewer(), ports))).toMatchObject({
      code: 'forbidden',
    });
    expect((await executeQuery(supportMacrosQuery, {}, b.ctx(), ports)).some((x) => x.id === macroId)).toBe(
      false,
    );
  });

  it('runs on an order: the reply filled in, a note, the tickets resent; idempotent; on the timeline', async () => {
    order = await buy('macro@example.test', 2);
    const preview = await executeQuery(
      previewSupportMacroQuery,
      { orderId: order.orderId, macroId },
      manager(),
      ports,
    );
    expect(preview.subject).toBe('Your tickets for Support Night');
    expect(preview.body).toMatch(/^Hi Buyer macro, we sent your 2 tickets again \(order [0-9A-F]{8}\)\.$/);
    const k = key();
    const r1 = await executeCommand(
      runSupportMacroCommand,
      { orderId: order.orderId, macroId },
      manager({ idempotencyKey: k }),
      ports,
    );
    const r2 = await executeCommand(
      runSupportMacroCommand,
      { orderId: order.orderId, macroId },
      manager({ idempotencyKey: k }),
      ports,
    );
    expect(r2.runId).toBe(r1.runId);
    expect(r1).toMatchObject({
      ticketsResent: 2,
      subject: preview.subject,
      body: preview.body,
      transfer: null,
    });
    const notes = await q<{ body: string }>(
      sql`select body from orders.order_notes where order_id = ${order.orderId}`,
    );
    expect(notes.map((n) => n.body)).toEqual([`Resend and note: ${preview.body}`]);
    const resends = await q<{ n: number }>(
      sql`select count(*)::int as n from platform.domain_events where type = 'ticket.resend_requested' and aggregate_id = ${r1.runId}`,
    );
    expect(resends[0]?.n).toBe(1);
    const memory = memoryNotifier();
    await drain(supportReplyMailer({ notifier: memory.notifier, appOrigin: 'https://app.test' }), [
      'order.support_reply',
    ]);
    expect(memory.sent.filter((m) => m.orderId === order.orderId)).toEqual([
      expect.objectContaining({
        kind: 'orders.support-reply',
        to: expect.objectContaining({ email: 'macro@example.test' }),
        params: expect.objectContaining({ subject: preview.subject, body: preview.body }),
      }),
    ]);
    const timeline = await executeQuery(orderTimelineQuery, { orderId: order.orderId }, a.ctx(), ports);
    expect(timeline.items.find((i) => i.kind === 'macro_run')).toMatchObject({
      text: 'Resend and note',
      code: 'email_buyer,add_note,resend_tickets',
    });
    expect(
      await refusal(
        executeCommand(
          runSupportMacroCommand,
          { orderId: order.orderId, macroId },
          { ...viewer(), idempotencyKey: key() },
          ports,
        ),
      ),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('a transfer macro needs the recipient and starts the transfer; archived macros do not run', async () => {
    const m = await executeCommand(
      saveSupportMacroCommand,
      {
        name: 'Transfer and email',
        subject: 'Your ticket is on its way to {{recipient_name}}',
        body: 'Hi {{buyer_name}}, {{recipient_name}} will get a claim link.',
        actions: ['transfer_ticket', 'email_buyer'],
      },
      a.ctx(),
      ports,
    );
    expect(
      await refusal(
        executeCommand(
          runSupportMacroCommand,
          { orderId: order.orderId, macroId: m.id },
          a.ctx({ idempotencyKey: key() }),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'validation_failed', details: { reason: 'transfer_required' } });
    // Staff acting as a member never move a ticket, through a macro either.
    expect(
      await refusal(
        executeCommand(
          runSupportMacroCommand,
          {
            orderId: order.orderId,
            macroId: m.id,
            transfer: { ticketId: order.ticketIds[1] ?? '', toName: 'X', toEmail: 'x@example.test' },
          },
          a.ctx({
            idempotencyKey: key(),
            impersonatedBy: { staffUserId: uuidv7(), impersonationId: uuidv7() },
          }),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'impersonation_blocked' });
    const r = await executeCommand(
      runSupportMacroCommand,
      {
        orderId: order.orderId,
        macroId: m.id,
        transfer: { ticketId: order.ticketIds[1] ?? '', toName: 'Rae Kim', toEmail: 'rae@example.test' },
      },
      a.ctx({ idempotencyKey: key() }),
      ports,
    );
    expect(r.subject).toBe('Your ticket is on its way to Rae Kim');
    expect(r.transfer?.token).toBeTruthy();
    const [t] = await executeQuery(orderTransfersQuery, { orderId: order.orderId }, a.ctx(), ports);
    expect(t).toMatchObject({ toName: 'Rae Kim', state: 'pending', initiatedBy: 'organizer' });
    await executeCommand(archiveSupportMacroCommand, { macroId: m.id }, a.ctx(), ports);
    expect(
      await refusal(
        executeCommand(
          runSupportMacroCommand,
          {
            orderId: order.orderId,
            macroId: m.id,
            transfer: { ticketId: order.ticketIds[1] ?? '', toName: 'X', toEmail: 'x@example.test' },
          },
          a.ctx({ idempotencyKey: key() }),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'not_found' });
    expect(
      await refusal(
        executeCommand(
          runSupportMacroCommand,
          { orderId: order.orderId, macroId },
          b.ctx({ idempotencyKey: key() }),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'not_found' });
  });
});
