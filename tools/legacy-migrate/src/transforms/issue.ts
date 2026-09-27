import { randomBytes } from 'node:crypto';
import { hashManageToken } from '@yayatoh/orders';
import { keyVault } from '@yayatoh/platform';
import { generateKeyPair, signTicketCode } from '@yayatoh/ticket-crypto';
import { detUuid } from '../ids.ts';
import { exec, rows, type StepContext } from './context.ts';

const BATCH = 2000;

/**
 * Codes and links for migrated orders (roadmap §7.5 "Legacy QR codes"):
 *  - every migrated ticket gets the org's signed yy1 code (the org's first signing key is created
 *    here, as ticket issuance would), so the buyer's order page and scanners work unchanged;
 *  - the legacy QR payload (the booking's `order_number`) is kept as a `legacy_eventmie` barcode on
 *    the booking's ticket, unique per (org, payload), so printed codes keep scanning. Issued codes are
 *    never regenerated. An `order_number` that repeats within the instance is not attached (it could
 *    admit the wrong ticket) and goes to owner review;
 *  - every migrated order gets a manage token (random; only its hash and its KeyVault envelope are
 *    stored), so the buyer's order link can be sent at cutover.
 */
export async function issueCodes(ctx: StepContext): Promise<void> {
  // Orgs of this instance with migrated tickets but no signing key yet.
  const needKey = await rows<{ org_id: string }>(
    ctx,
    `select distinct r.org_id from legacy.ref r
     where r.instance = {inst} and r.entity = 'booking_units'
       and not exists (select 1 from ticketing.signing_keys k where k.org_id = r.org_id and k.active)`,
  );
  for (const { org_id } of needKey) {
    const pair = await generateKeyPair();
    await ctx.sql`
      insert into ticketing.signing_keys (org_id, kid, public_key, private_key_ciphertext, active)
      values (${org_id}, 1, ${Buffer.from(pair.publicKey).toString('base64')},
              ${await keyVault().encrypt(org_id, pair.privateKey)}, true)
      on conflict (org_id, kid) do nothing`;
  }
  const keys = new Map<string, { kid: number; privateKey: Uint8Array }>();
  const keyFor = async (orgId: string) => {
    let k = keys.get(orgId);
    if (!k) {
      const [row] = await ctx.sql<{ kid: number; private_key_ciphertext: string }[]>`
        select kid, private_key_ciphertext from ticketing.signing_keys
        where org_id = ${orgId} and active order by kid desc limit 1`;
      if (!row) throw new Error(`no signing key for org ${orgId}`);
      k = { kid: row.kid, privateKey: await keyVault().decrypt(orgId, row.private_key_ciphertext) };
      keys.set(orgId, k);
    }
    return k;
  };

  // yy1 codes for migrated tickets that have none (read once, written in batches).
  const pending = await rows<{ id: string; org_id: string; rev: number }>(
    ctx,
    `select t.id, t.org_id, t.rev from legacy.ref r join ticketing.tickets t on t.id = r.new_id
     where r.instance = {inst} and r.entity = 'booking_units'
       and not exists (select 1 from ticketing.ticket_barcodes b
                       where b.org_id = t.org_id and b.ticket_id = t.id and b.format = 'yy1')`,
  );
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const values = [];
    for (const t of batch) {
      const key = await keyFor(t.org_id);
      values.push({
        id: detUuid(null, `barcode|yy1|${t.id}|${t.rev}`),
        org_id: t.org_id,
        ticket_id: t.id,
        format: 'yy1',
        instance: null,
        payload: await signTicketCode({ kid: key.kid, ticketId: t.id, rev: t.rev }, key.privateKey),
        rev: t.rev,
        active: true,
      });
    }
    await ctx.sql`insert into ticketing.ticket_barcodes ${ctx.sql(values)} on conflict do nothing`;
  }

  // Legacy QR payloads.
  await exec(
    ctx,
    `
    drop table if exists ti_payloads;
    create temp table ti_payloads as
    select b.id as legacy_id, btrim(b.order_number) as payload, count(*) over (partition by btrim(b.order_number)) as uses
    from {s}.bookings b where nullif(btrim(b.order_number), '') is not null;

    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'duplicate_order_number', 'bookings', p.legacy_id::text,
           jsonb_build_object('order_number', p.payload, 'bookings', p.uses)
    from ti_payloads p where p.uses > 1;

    insert into ticketing.ticket_barcodes (id, org_id, ticket_id, format, instance, payload, rev, active, created_at, updated_at)
    select legacy.det_uuid(null, 'barcode|legacy|' || {inst} || '|' || p.payload), r.org_id, r.new_id, 'legacy_eventmie', {inst},
           p.payload, 0, true, now(), now()
    from ti_payloads p
    join legacy.ref r on r.instance = {inst} and r.entity = 'bookings' and r.legacy_id = p.legacy_id::text
    where p.uses = 1
    on conflict do nothing;
  `,
  );

  // Manage tokens for migrated orders (random secrets: only the hash and the envelope are stored).
  for (;;) {
    const batch = await ctx.sql<{ id: string; org_id: string }[]>`
      select id, org_id from orders.orders where manage_token_hash like 'legacy-unissued:%' limit ${BATCH}`;
    if (!batch.length) break;
    const values = [];
    for (const o of batch) {
      const token = randomBytes(32).toString('base64url');
      values.push({
        id: o.id,
        hash: hashManageToken(token),
        cipher: await keyVault().encrypt(o.org_id, new TextEncoder().encode(token)),
      });
    }
    await ctx.sql`
      update orders.orders o set manage_token_hash = v.hash, manage_token_ciphertext = v.cipher
      from (values ${ctx.sql(values.map((v) => [v.id, v.hash, v.cipher]))}) as v(id, hash, cipher)
      where o.id = v.id::uuid and o.manage_token_hash like 'legacy-unissued:%'`;
  }
}
