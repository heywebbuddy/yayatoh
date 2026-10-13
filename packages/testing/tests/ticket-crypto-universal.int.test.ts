import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { base32Decode, verifyTicketCode } from '@yayatoh/ticket-crypto';
import { createTicketTypeCommand, publicKeysTx } from '@yayatoh/ticketing';
import { type ManifestRow, type OfflineState, offlineVerdict, uuidv7Time } from '@yayatoh/checkin-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * M7.1a: codes the server signs (WebCrypto-era keys in the vault, `issue.ts`) verify with the
 * pure-JavaScript verifier the Scan PWA and the Staff app use, and give the same door verdicts.
 */
let a: OrgFixture;
let eventId: string;
let ticketTypeId: string;

beforeAll(async () => {
  ({ a } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    { name: 'Universal crypto', timezone: 'UTC', startsAt: '2027-12-01T18:00:00Z', endsAt: '2027-12-01T23:00:00Z' },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  const t = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'Free', priceMinor: 0, quantityTotal: 50 },
    a.ctx(),
    ports,
  );
  ticketTypeId = t.id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

async function issued(n: number) {
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId, quantity: n }],
      buyer: { email: `universal-${Date.now()}@example.test`, name: 'Universal' },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const page = await orderByManageToken(r.manageToken);
  return page?.tickets ?? [];
}

describe('codes issued by the server', () => {
  it('verify with the pure-JavaScript verifier, and with Web Crypto too (same bytes, same answer)', async () => {
    const tickets = await issued(3);
    expect(tickets).toHaveLength(3);
    const keys = await withTenant(systemCtx(a.org.id), (tx) => publicKeysTx(tx));
    const raw = keys.get(1) as Uint8Array;
    const subtle = globalThis.crypto.subtle;
    const publicKey = await subtle.importKey('raw', new Uint8Array(raw), { name: 'Ed25519' }, false, ['verify']);
    for (const t of tickets) {
      expect(await verifyTicketCode(t.code, keys)).toEqual({ ok: true, kid: 1, ticketId: t.id, rev: 0 });
      // The independent check: Web Crypto verifies the server's signature over the signed bytes.
      const bytes = base32Decode(t.code.slice(3)) as Uint8Array;
      const message = new Uint8Array([...new TextEncoder().encode('yayatoh-ticket-v1'), ...bytes.slice(0, 21)]);
      expect(await subtle.verify({ name: 'Ed25519' }, publicKey, bytes.slice(21), message)).toBe(true);
    }
  });

  it('a tampered issued code is refused by both', async () => {
    const [t] = await issued(1);
    if (!t) throw new Error('no ticket');
    const keys = await withTenant(systemCtx(a.org.id), (tx) => publicKeysTx(tx));
    const tampered = `${t.code.slice(0, 60)}${t.code[60] === 'A' ? 'B' : 'A'}${t.code.slice(61)}`;
    expect(await verifyTicketCode(tampered, keys)).toMatchObject({ ok: false });
  });

  it('give the door verdicts: admit, duplicate on this device, refuse a foreign key', async () => {
    const tickets = await issued(2);
    const keys = await withTenant(systemCtx(a.org.id), (tx) => publicKeysTx(tx));
    const rows: ManifestRow[] = tickets.map((t) => ({
      ticketId: t.id,
      shortCode: t.shortCode,
      rev: 0,
      status: 'active',
      ticketTypeId,
      typeName: 'Free',
      accessDates: [],
      holderName: 'Universal',
      emailHash: '',
      issuedAt: new Date(uuidv7Time(t.id)).toISOString(),
    }));
    const now = new Date('2027-12-01T19:00:00Z');
    const state = (admitted: string[]): OfflineState => ({
      header: {
        event: {
          id: eventId,
          name: 'Universal crypto',
          startsAt: '2027-12-01T18:00:00Z',
          endsAt: '2027-12-01T23:00:00Z',
          timezone: 'UTC',
        },
        publicKeys: { '1': Buffer.from(keys.get(1) as Uint8Array).toString('base64') },
        salt: 's',
        serverTime: now.toISOString(),
        unknownPolicy: 'provisional',
        checkpoints: [],
      },
      byId: new Map(rows.map((r) => [r.ticketId, r])),
      byShortCode: new Map(rows.map((r) => [r.shortCode, r])),
      admitted: new Set(admitted),
      lastSyncAt: new Date(Date.now() + 60_000),
    });
    const [t1, t2] = tickets;
    if (!t1 || !t2) throw new Error('need two tickets');
    expect((await offlineVerdict(state([]), t1.code, now)).verdict).toBe('admit');
    expect((await offlineVerdict(state([`${t1.id}:2027-12-01`]), t1.code, now)).verdict).toBe('duplicate');
    expect((await offlineVerdict(state([`${t1.id}:2027-12-01`]), t2.code, now)).verdict).toBe('admit');
    // The same code against a manifest that carries another org's key: refused.
    const foreign = state([]);
    const other = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const otherRaw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', (other as CryptoKeyPair).publicKey));
    const swapped: OfflineState = {
      ...foreign,
      header: { ...foreign.header, publicKeys: { '1': Buffer.from(otherRaw).toString('base64') } },
    };
    expect((await offlineVerdict(swapped, t1.code, now)).verdict).toBe('invalid');
  });
});
