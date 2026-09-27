import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { verifyTicketCode } from '@yayatoh/ticket-crypto';
import { createTicketTypeCommand, issueTicketsTx, publicKeysTx } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let free: { id: string };

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    { name: 'Tickets', timezone: 'UTC', startsAt: '2027-12-01T18:00:00Z', endsAt: '2027-12-01T23:00:00Z' },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  free = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'Free', priceMinor: 0, quantityTotal: 100 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

const buy = (quantity: number, n: string) =>
  executeCommand(
    startCheckoutCommand,
    { eventId, items: [{ ticketTypeId: free.id, quantity }], buyer: { email: `${n}@example.test`, name: n } },
    createCtx({ orgId: a.org.id }),
    ports,
  );

describe('tickets', () => {
  it('a paid order carries one signed ticket per unit, with sequential serials', async () => {
    const r = await buy(3, 'holder');
    const page = await orderByManageToken(r.manageToken);
    expect(page?.tickets).toHaveLength(3);
    const serials = page?.tickets.map((t) => t.serial) ?? [];
    expect(serials).toEqual([serials[0], (serials[0] ?? 0) + 1, (serials[0] ?? 0) + 2]);
    for (const t of page?.tickets ?? []) {
      expect(t).toMatchObject({ holderName: 'holder', status: 'active', ticketTypeId: free.id });
      expect(t.shortCode).toMatch(/^[2-9A-HJKMNP-TV-Z]{8}$/);
      expect(t.code).toMatch(/^YY1[A-Z2-7]+$/);
      expect(t.code).toHaveLength(139);
    }
  });

  it('codes verify with the org public key and fail with another org key', async () => {
    const r = await buy(1, 'verify');
    const t = (await orderByManageToken(r.manageToken))?.tickets[0];
    if (!t) throw new Error('no ticket');
    const keysA = await withTenant(systemCtx(a.org.id), (tx) => publicKeysTx(tx));
    const keysB = await withTenant(systemCtx(b.org.id), (tx) => publicKeysTx(tx));
    expect(await verifyTicketCode(t.code, keysA)).toEqual({ ok: true, kid: 1, ticketId: t.id, rev: 0 });
    // Both orgs have kid 1 (keys are per org), so a foreign code has a bad signature, not an unknown key.
    expect(await verifyTicketCode(t.code, keysB)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses to issue twice for the same order', async () => {
    const r = await buy(1, 'twice');
    await expect(
      withTenant(systemCtx(a.org.id), (tx) =>
        issueTicketsTx(tx, systemCtx(a.org.id), {
          orderId: r.order.id,
          eventId,
          items: [],
          holder: { name: 'x', email: 'x@example.test' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('private keys are stored encrypted, never as raw pkcs8', async () => {
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ c: string }>(sql`select private_key_ciphertext as c from ticketing.signing_keys limit 1`),
    );
    expect(row?.c).toBeTruthy();
    // A raw Ed25519 pkcs8 key starts with 302e0201 (MC4CAQ in base64).
    expect(String(row?.c)).not.toMatch(/^MC4CAQ/);
  });

  it('isolation: org B sees none of org A tickets', async () => {
    const rows = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ org_id: string }>(sql`select org_id from ticketing.tickets`),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.org_id === b.org.id)).toBe(true);
  });
});
