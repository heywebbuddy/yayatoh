import { checkpointsForTicketTx, createCheckpointCommand } from '@yayatoh/checkin';
import { type ManifestRow, type OfflineState, offlineVerdict } from '@yayatoh/checkin-engine';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, eventTicketFactsTx, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import {
  myOrderDetail,
  myOrderRefundTarget,
  orderByManageToken,
  startCheckoutCommand,
} from '@yayatoh/orders';
import { consumeEvent, eventKey, recentEventsTx, type Subscriber } from '@yayatoh/platform';
import {
  cancelAppTransferCommand,
  claimContext,
  claimTicketForPersonCommand,
  createTicketTypeCommand,
  fakeWalletPassProvider,
  holderWalletPassTx,
  issueAppHolderLinkCommand,
  markWalletPassesPushedTx,
  myTicketsTx,
  publicKeysTx,
  startAppTransferCommand,
  updateTicketTypeCommand,
  walletPassSync,
} from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * M7.2b, below the HTTP layer: a person's own tickets are read under one org's RLS by verified
 * email only; the transfer, cancel and claim commands that serve the app enforce the ticket type's
 * rules, the holder and the recipient themselves (not the routes); and after a transfer the sender's
 * list drops the ticket, the door's offline table refuses the old code as superseded, and the wallet
 * provider is told to void the old pass.
 */
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let typeId: string;
const STARTS = '2027-12-01T18:00:00Z';
const ENDS = '2027-12-01T23:00:00Z';
const DURING = new Date('2027-12-01T20:00:00Z');

const publicCtx = (now?: Date) => createCtx({ orgId: a.org.id, ...(now ? { now } : {}) });
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err as { code: string; details?: Record<string, unknown> };
  }
  throw new Error('expected a refusal');
};
const tag = uuidv7().slice(-8);
const email = (name: string) => `${name}-${tag}@example.test`;

async function buyFree(org: OrgFixture, event: string, type: string, buyer: string, quantity = 1) {
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId: event,
      items: [{ ticketTypeId: type, quantity }],
      buyer: { email: buyer, name: `Buyer ${buyer.split('@')[0]}` },
    },
    createCtx({ orgId: org.org.id }),
    ports,
  );
  const order = await orderByManageToken(c.manageToken);
  return { orderId: c.order.id, token: c.manageToken, tickets: order?.tickets ?? [] };
}

const mine = (org: OrgFixture, address: string, ticketId?: string) =>
  withTenant(systemCtx(org.org.id), (tx) =>
    myTicketsTx(tx, systemCtx(org.org.id), org.org.id, address, ticketId ? { ticketId } : {}),
  );

async function drain(sub: Subscriber, types: string[]) {
  const events = await withTenant(systemCtx(a.org.id), (tx) =>
    recentEventsTx(tx, a.org.id, types, 3_600_000),
  );
  for (const e of events) if (sub.events.includes(eventKey(e))) await consumeEvent(sub, e);
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      { name: 'My Tickets Night', timezone: 'UTC', startsAt: STARTS, endsAt: ENDS },
      a.ctx(),
      ports,
    )
  ).id;
  typeId = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'Floor', priceMinor: 0, quantityTotal: 100, maxPerOrder: 10 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

describe('a person’s tickets are read by verified email, under one org’s RLS', () => {
  it('finds the tickets whose holder address matches, however it is spelled; nobody else’s', async () => {
    const who = email('lena');
    const bought = await buyFree(a, eventId, typeId, who.toUpperCase(), 2);
    const rows = await mine(a, who);
    expect(rows.map((r) => r.id).sort()).toEqual(bought.tickets.map((t) => t.id).sort());
    expect(rows[0]).toMatchObject({
      orgId: a.org.id,
      status: 'active',
      rev: 0,
      ticketTypeName: 'Floor',
      event: { name: 'My Tickets Night', timezone: 'UTC' },
      transfer: { allowed: true, feeMinor: 0 },
    });
    // The code is the order page's code.
    expect(new Map(rows.map((r) => [r.id, r.qrCode]))).toEqual(
      new Map(bought.tickets.map((t) => [t.id, t.code])),
    );
    expect(await mine(a, email('someone-else'))).toEqual([]);
    // The other org's RLS: the same address, the same ticket id, nothing.
    expect(await mine(b, who)).toEqual([]);
    expect(await mine(b, who, bought.tickets[0]?.id)).toEqual([]);
  });

  it('a voided ticket is not listed, and its detail has no code', async () => {
    const who = email('mo');
    const bought = await buyFree(a, eventId, typeId, who, 1);
    const id = bought.tickets[0]?.id as string;
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`update ticketing.tickets set status = 'void' where id = ${id}`),
    );
    expect(await mine(a, who)).toEqual([]);
    const [detail] = await mine(a, who, id);
    expect(detail).toMatchObject({
      id,
      status: 'void',
      qrCode: null,
      transfer: { allowed: false, reason: 'ticket_void' },
    });
  });

  it('an order is found only through the buyer’s verified address', async () => {
    const who = email('ned');
    const bought = await buyFree(a, eventId, typeId, who, 1);
    expect(await myOrderDetail(who.toUpperCase(), bought.orderId)).toMatchObject({
      id: bought.orderId,
      orgId: a.org.id,
      ticketIds: bought.tickets.map((t) => t.id),
      transferred: 0,
    });
    expect(await myOrderDetail(email('nobody'), bought.orderId)).toBeNull();
    expect(await myOrderRefundTarget(email('nobody'), bought.orderId)).toBeNull();
    // A free order is not refundable, but the buyer can read it (the manage link stays server-side).
    expect(await myOrderRefundTarget(who, bought.orderId)).toMatchObject({
      orgId: a.org.id,
      manageToken: bought.token,
    });
  });

  it('entrances and the zones a ticket type may enter are the ones listed', async () => {
    await executeCommand(
      createCheckpointCommand,
      { eventId, name: 'Main door', kind: 'entrance' },
      a.ctx(),
      ports,
    );
    const other = await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'Backstage', priceMinor: 0, quantityTotal: 5, visibility: 'hidden' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      createCheckpointCommand,
      { eventId, name: 'Green room', kind: 'zone', ticketTypeIds: [other.id] },
      a.ctx(),
      ports,
    );
    await executeCommand(createCheckpointCommand, { eventId, name: 'Lounge', kind: 'zone' }, a.ctx(), ports);
    const names = (ticketType: string) =>
      withTenant(systemCtx(a.org.id), (tx) => checkpointsForTicketTx(tx, eventId, ticketType)).then((r) =>
        r.map((c) => `${c.kind}:${c.name}`).sort(),
      );
    expect(await names(typeId)).toEqual(['entrance:Main door', 'zone:Lounge']);
    expect(await names(other.id)).toEqual(['entrance:Main door', 'zone:Green room', 'zone:Lounge']);
    const facts = await withTenant(systemCtx(a.org.id), (tx) => eventTicketFactsTx(tx, [eventId]));
    expect(facts.get(eventId)).toEqual({ venueId: null, brandColor: null });
  });
});

describe('the app’s transfer and claim commands enforce the rules themselves', () => {
  let sender: string;
  let ticketId: string;

  beforeAll(async () => {
    sender = email('sender');
    ticketId = (await buyFree(a, eventId, typeId, sender, 2)).tickets[0]?.id as string;
  });

  const start = (over: Record<string, unknown> = {}, now?: Date) =>
    executeCommand(
      startAppTransferCommand,
      { holderEmail: sender, ticketId, toName: 'Pia', toEmail: email('pia'), ...over },
      publicCtx(now),
      ports,
    );

  it('only the address that holds the ticket may transfer or cancel it', async () => {
    expect(await refusal(start({ holderEmail: email('thief') }))).toMatchObject({ code: 'not_found' });
    expect(await refusal(start({ toEmail: sender.toUpperCase() }))).toMatchObject({
      code: 'validation_failed',
      details: { reason: 'same_holder' },
    });
    const ok = await start();
    expect(ok).toEqual({ transferId: expect.any(String), claimId: expect.any(String), feeMinor: 0 });
    expect(JSON.stringify(ok)).not.toContain('~');
    const cancel = (over: Record<string, unknown> = {}) =>
      executeCommand(
        cancelAppTransferCommand,
        { holderEmail: sender, ticketId, transferId: ok.transferId, ...over },
        publicCtx(),
        ports,
      );
    expect(await refusal(cancel({ holderEmail: email('thief') }))).toMatchObject({ code: 'not_found' });
    expect(await refusal(cancel({ ticketId: uuidv7() }))).toMatchObject({ code: 'not_found' });
    expect(await cancel()).toEqual({ ok: true });
    expect(await refusal(cancel())).toMatchObject({ code: 'invalid_state' });
  });

  it('the ticket type decides: not allowed, past the cutoff, and a fee must be agreed', async () => {
    const rules = (patch: Record<string, unknown>) =>
      executeCommand(updateTicketTypeCommand, { ticketTypeId: typeId, ...patch }, a.ctx(), ports);
    await rules({ transfersAllowed: false });
    expect(await refusal(start())).toMatchObject({
      code: 'invalid_state',
      details: { reason: 'not_allowed' },
    });
    // Cutoff 48 h before the start: the day before the event is already too late.
    await rules({ transfersAllowed: true, transferCutoffHours: 48 });
    expect(await refusal(start({}, new Date('2027-11-30T20:00:00Z')))).toMatchObject({
      code: 'invalid_state',
      details: { reason: 'deadline_passed', deadline: '2027-11-29T18:00:00.000Z' },
    });
    await rules({ transferCutoffHours: 24, transferFeeMinor: 300 });
    expect(await refusal(start())).toMatchObject({
      code: 'validation_failed',
      details: { reason: 'fee_not_accepted' },
    });
    // The web link for the fee: a holder link only for a ticket the address holds.
    const link = await executeCommand(
      issueAppHolderLinkCommand,
      { holderEmail: sender, ticketId },
      publicCtx(),
      ports,
    );
    expect(link.token).toMatch(/~/);
    expect(
      await refusal(
        executeCommand(
          issueAppHolderLinkCommand,
          { holderEmail: email('thief'), ticketId },
          publicCtx(),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'not_found' });
    await rules({ transferCutoffHours: null, transferFeeMinor: 0 });
  });

  it('a transfer is claimed by the address it was sent to, once', async () => {
    const to = email('quinn');
    const started = await start({ toName: 'Quinn', toEmail: to });
    const [claim] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string }>(
        sql`select claim_id as id from ticketing.ticket_transfers where id = ${started.transferId}`,
      ),
    );
    const claimId = claim?.id as string;
    const claimAs = (address: string) =>
      executeCommand(
        claimTicketForPersonCommand,
        { claimId, name: 'Quinn', email: address },
        publicCtx(),
        ports,
      );
    expect(await refusal(claimAs(email('not-quinn')))).toMatchObject({
      code: 'validation_failed',
      details: { reason: 'email_mismatch' },
    });
    expect(await mine(a, to)).toEqual([]);
    expect(await claimAs(to.toUpperCase())).toEqual({ ticketId });
    expect(await refusal(claimAs(to))).toMatchObject({
      code: 'invalid_state',
      details: { state: 'claimed' },
    });
    expect((await mine(a, to)).map((t) => t.id)).toEqual([ticketId]);
    expect(await claimContext('nope')).toBeNull();
  });
});

describe('after a transfer: the sender’s list, the door and the wallet', () => {
  it('drops the ticket from the sender, supersedes the old code at the door and voids the old pass', async () => {
    const sender = email('vera');
    const recipient = email('wes');
    const bought = await buyFree(a, eventId, typeId, sender, 1);
    const ticketId = bought.tickets[0]?.id as string;
    const [before] = await mine(a, sender);
    const oldCode = before?.qrCode as string;
    expect(oldCode).toBe(bought.tickets[0]?.code);

    // The sender adds the ticket to a wallet: one live pass for the current code.
    const wallet = fakeWalletPassProvider();
    const ctx = systemCtx(a.org.id);
    const pass = await withTenant(ctx, (tx) => holderWalletPassTx(tx, ctx, sender, ticketId));
    expect(pass).toMatchObject({ serial: `yy-${ticketId}-0`, rev: 0, pushed: false });
    await wallet.upsertPass({
      serial: pass?.serial as string,
      ticketId,
      rev: 0,
      holderName: pass?.holderName as string,
      eventName: pass?.eventName as string,
    });
    await withTenant(ctx, (tx) => markWalletPassesPushedTx(tx, [pass?.id as string], new Date()));
    // Asking again does not make a second pass; another address gets none.
    expect((await withTenant(ctx, (tx) => holderWalletPassTx(tx, ctx, sender, ticketId)))?.id).toBe(pass?.id);
    expect(await withTenant(ctx, (tx) => holderWalletPassTx(tx, ctx, recipient, ticketId))).toBeNull();

    const started = await executeCommand(
      startAppTransferCommand,
      { holderEmail: sender, ticketId, toName: 'Wes', toEmail: recipient },
      publicCtx(),
      ports,
    );
    // Until it is claimed the ticket is still the sender's, and the old code still works.
    expect((await mine(a, sender)).map((t) => t.id)).toEqual([ticketId]);
    expect((await mine(a, sender))[0]?.transfer).toMatchObject({ pendingTransferId: started.transferId });
    await executeCommand(
      claimTicketForPersonCommand,
      { claimId: started.claimId, name: 'Wes', email: recipient },
      publicCtx(),
      ports,
    );

    // The sender's list drops it; the recipient's has it with a new revision and code.
    expect(await mine(a, sender)).toEqual([]);
    const [now] = await mine(a, recipient);
    expect(now).toMatchObject({ id: ticketId, rev: 1, holderName: 'Wes' });
    expect(now?.qrCode).not.toBe(oldCode);

    // The door's offline table: the manifest row carries the new revision.
    const keys = await withTenant(ctx, (tx) => publicKeysTx(tx));
    const row: ManifestRow = {
      ticketId,
      shortCode: now?.shortCode as string,
      rev: 1,
      status: 'active',
      ticketTypeId: typeId,
      typeName: 'Floor',
      accessDates: [],
      holderName: 'Wes',
      emailHash: '',
      issuedAt: new Date().toISOString(),
    };
    const state: OfflineState = {
      header: {
        event: { id: eventId, name: 'My Tickets Night', startsAt: STARTS, endsAt: ENDS, timezone: 'UTC' },
        publicKeys: Object.fromEntries(
          [...keys].map(([kid, key]) => [String(kid), Buffer.from(key).toString('base64')]),
        ),
        salt: 's',
        serverTime: new Date().toISOString(),
        unknownPolicy: 'reject',
        checkpoints: [],
      },
      byId: new Map([[ticketId, row]]),
      byShortCode: new Map([[row.shortCode, row]]),
      admitted: new Set(),
      lastSyncAt: new Date(),
    };
    expect((await offlineVerdict(state, oldCode, DURING)).verdict).toBe('superseded');
    expect((await offlineVerdict(state, now?.qrCode as string, DURING)).verdict).toBe('admit');

    // The wallet provider is told: the old pass voided, one for the new holder issued.
    const sync = walletPassSync({ provider: wallet });
    await drain(sync, ['ticket.transferred']);
    await drain(sync, ['ticket.transferred']);
    expect(wallet.pushes.filter((p) => p.serial.includes(ticketId))).toEqual([
      { op: 'upsert', serial: `yy-${ticketId}-0`, holderName: pass?.holderName },
      { op: 'void', serial: `yy-${ticketId}-0` },
      { op: 'upsert', serial: `yy-${ticketId}-1`, holderName: 'Wes' },
    ]);
    const passes = await withTenant(ctx, (tx) =>
      tx.execute<{ rev: number; status: string }>(
        sql`select rev, status from ticketing.wallet_passes where ticket_id = ${ticketId} order by rev`,
      ),
    );
    expect([...passes]).toEqual([
      { rev: 0, status: 'voided' },
      { rev: 1, status: 'active' },
    ]);
    // The old holder can no longer make a pass; the new holder gets the current one.
    expect(await withTenant(ctx, (tx) => holderWalletPassTx(tx, ctx, sender, ticketId))).toBeNull();
    expect(await withTenant(ctx, (tx) => holderWalletPassTx(tx, ctx, recipient, ticketId))).toMatchObject({
      rev: 1,
      serial: `yy-${ticketId}-1`,
    });
  });
});
