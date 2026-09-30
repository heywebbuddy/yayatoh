import { listAttendeesQuery } from '@yayatoh/attendees';
import { scanTicketCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import {
  claimContext,
  claimDetailsQuery,
  claimTicketCommand,
  createClaimLinksCommand,
  createTicketTypeCommand,
  giveTicketCommand,
  holderContext,
  holderTicketsQuery,
  listClaimLinksQuery,
  requestHolderLinkCommand,
  revokeClaimLinkCommand,
} from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let tickets: { id: string; code: string; shortCode: string }[];
let manageToken: string;

const DURING = new Date('2027-12-01T20:00:00Z');

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    {
      name: 'Distribution',
      timezone: 'UTC',
      startsAt: '2027-12-01T18:00:00Z',
      endsAt: '2027-12-01T23:00:00Z',
    },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  const t = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'Table seat', priceMinor: 0, quantityTotal: 50, maxPerOrder: 10 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: t.id, quantity: 6 }],
      buyer: { email: 'host@example.test', name: 'Hosting Co' },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  manageToken = r.manageToken;
  tickets = ((await orderByManageToken(r.manageToken))?.tickets ?? []).map((x) => ({
    id: x.id,
    code: x.code,
    shortCode: x.shortCode,
  }));
});
afterAll(closePools);

const links = (ticketIds: string[], extra: Record<string, unknown> = {}) =>
  executeCommand(createClaimLinksCommand, { eventId, ticketIds, ...extra }, a.ctx(), ports);
async function claimAs(token: string, name: string, email: string, now?: Date) {
  const c = await claimContext(token);
  if (!c) throw new Error('claim token did not resolve');
  const ctx: Ctx = now ? { ...c.ctx, now } : c.ctx;
  return executeCommand(claimTicketCommand, { claimId: c.id, name, email }, ctx, ports);
}
const scan = (code: string) =>
  executeCommand(scanTicketCommand, { eventId, code }, a.ctx({ now: DURING }), ports).then((x) => x.result);
const outbox = (type: string) =>
  withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ n: number }>(
      sql`select count(*)::int as n from platform.domain_events where type = ${type}`,
    ),
  ).then((r) => r[0]?.n ?? 0);

describe('distribution: claim links and holder self-service (M1.8d)', () => {
  it('a claimed ticket is reissued to the claimant; the old QR is rejected, the new one admits', async () => {
    const t0 = tickets[0] as (typeof tickets)[number];
    const [link] = await links([t0.id], { recipientEmail: 'guest@example.test' });
    expect(link?.token).toMatch(/^[0-9a-f-]{36}~[A-Za-z0-9_-]+$/);
    expect(await outbox('ticket.claim_link_created')).toBeGreaterThanOrEqual(1);
    const c = await claimContext(link?.token as string);
    expect(
      await executeQuery(claimDetailsQuery, { claimId: c?.id as string }, c?.ctx as Ctx, ports),
    ).toMatchObject({
      state: 'open',
      ticketTypeName: 'Table seat',
      event: { name: 'Distribution' },
    });

    const res = await claimAs(link?.token as string, 'Grace Guest', 'Grace@Example.test');
    expect(res.holderToken).toMatch(/~/);
    // The buyer's old code no longer scans; the claimant's new one does.
    expect(await scan(t0.code)).toBe('invalid');
    expect(await scan(t0.shortCode)).toBe('invalid');
    const h = await holderContext(res.holderToken as string);
    const mine = await executeQuery(holderTicketsQuery, { linkId: h?.id as string }, h?.ctx as Ctx, ports);
    expect(mine.tickets).toHaveLength(1);
    expect(mine.tickets[0]).toMatchObject({ id: t0.id, holderName: 'Grace Guest' });
    expect(mine.tickets[0]?.shortCode).not.toBe(t0.shortCode);
    expect(mine.tickets[0]?.code).not.toBe(t0.code);
    expect(await scan(mine.tickets[0]?.code as string)).toBe('admitted');
    // The ticket's attendee is now the claimant.
    const att = await executeQuery(listAttendeesQuery, { eventId, search: 'grace' }, a.ctx(), ports);
    expect(att.items.map((x) => [x.name, x.email])).toEqual([['Grace Guest', 'Grace@Example.test']]);
    // The buyer's order page no longer shows the passed-on ticket or its new code.
    const order = await orderByManageToken(manageToken);
    expect(order?.tickets.map((x) => x.id)).not.toContain(t0.id);
    expect(order?.transferred).toBe(1);
    expect(JSON.stringify(order)).not.toContain(mine.tickets[0]?.code as string);
    // A link works once.
    await expect(claimAs(link?.token as string, 'Mallory', 'm@example.test')).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('holders pass a ticket on from their magic link; it leaves their list once claimed', async () => {
    const res = await claimAs(
      (await links([(tickets[1] as { id: string }).id]))[0]?.token as string,
      'Hal',
      'hal@example.test',
    );
    const h = await holderContext(res.holderToken as string);
    const hctx = h?.ctx as Ctx;
    const given = await executeCommand(
      giveTicketCommand,
      { linkId: h?.id as string, ticketId: (tickets[1] as { id: string }).id },
      hctx,
      ports,
    );
    expect(
      (await executeQuery(holderTicketsQuery, { linkId: h?.id as string }, hctx, ports)).tickets[0]
        ?.pendingTransfer,
    ).toBe(true);
    await claimAs(given.token, 'Ivy', 'ivy@example.test');
    expect(
      (await executeQuery(holderTicketsQuery, { linkId: h?.id as string }, hctx, ports)).tickets,
    ).toEqual([]);
    // Someone else's ticket can't be given away with my link.
    await expect(
      executeCommand(
        giveTicketCommand,
        { linkId: h?.id as string, ticketId: (tickets[2] as { id: string }).id },
        hctx,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('revoked, replaced and expired links are refused', async () => {
    const t = (tickets[3] as { id: string }).id;
    const [first] = await links([t]);
    const [second] = await links([t]);
    await expect(claimAs(first?.token as string, 'Old', 'old@example.test')).rejects.toMatchObject({
      code: 'invalid_state',
      details: { state: 'revoked' },
    });
    const listed = await executeQuery(listClaimLinksQuery, { eventId, ticketIds: [t] }, a.ctx(), ports);
    expect(listed.map((x) => x.state)).toEqual(['open', 'revoked']);
    await expect(
      claimAs(second?.token as string, 'Late', 'late@example.test', new Date(Date.now() + 31 * 86_400_000)),
    ).rejects.toMatchObject({ details: { state: 'expired' } });
    await executeCommand(
      revokeClaimLinkCommand,
      { eventId, claimId: second?.claimId as string },
      a.ctx(),
      ports,
    );
    await expect(claimAs(second?.token as string, 'Nope', 'nope@example.test')).rejects.toMatchObject({
      details: { state: 'revoked' },
    });
  });

  it('holder links: no enumeration, rate-limited, and tokens are purpose-bound', async () => {
    const anon = createCtx({ orgId: a.org.id });
    const before = await outbox('ticket.holder_link_created');
    await executeCommand(requestHolderLinkCommand, { eventId, email: 'nobody@example.test' }, anon, ports);
    expect(await outbox('ticket.holder_link_created')).toBe(before);
    for (let i = 0; i < 5; i++)
      await expect(
        executeCommand(requestHolderLinkCommand, { eventId, email: 'HOST@example.test' }, anon, ports),
      ).resolves.toEqual({ ok: true });
    expect(await outbox('ticket.holder_link_created')).toBe(before + 3);
    const [link] = await links([(tickets[4] as { id: string }).id]);
    expect(await holderContext(link?.token as string)).toBeNull();
    expect(await claimContext(`${link?.token.slice(0, -2)}xx`)).toBeNull();
  });

  it('permissions and isolation', async () => {
    const t = (tickets[5] as { id: string }).id;
    await expect(
      executeCommand(
        createClaimLinksCommand,
        { eventId, ticketIds: [t] },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(createClaimLinksCommand, { eventId, ticketIds: [t] }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    const [link] = await links([t]);
    const c = await claimContext(link?.token as string);
    await expect(
      executeQuery(claimDetailsQuery, { claimId: c?.id as string }, createCtx({ orgId: b.org.id }), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
