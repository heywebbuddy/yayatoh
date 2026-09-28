import { migratorSql } from '@yayatoh/db/migration';
import { keyVault } from '@yayatoh/platform';
import { DEMO, SYNTH_PASSWORD } from './synth/generate.ts';

/**
 * Handles the browser tests need after `migrate:legacy:demo`: the migrated demo org and events, the
 * owner's synthetic credentials, a migrated buyer's order link (its manage token, decrypted from the
 * envelope the migration stored) and one legacy QR payload per viewport project to scan. Written to a
 * gitignored file; the data is synthetic and lives only in a throwaway database.
 */
export async function demoHandles() {
  const sql = migratorSql();
  const one = async <T>(q: Promise<T[]>, what: string): Promise<T> => {
    const [row] = await q;
    if (!row) throw new Error(`demo: ${what} not found (did the yay demo migration run?)`);
    return row;
  };
  const org = await one(
    sql<{ id: string; slug: string; name: string }[]>`
      select o.id, o.slug, o.name from legacy_yay.users u
      join legacy.ref r on r.instance = 'yay' and r.entity = 'organizers' and r.legacy_id = u.id::text
      join tenancy.organizations o on o.id = r.new_id
      where u.email = ${DEMO.ownerEmail}`,
    'demo org',
  );
  const event = async (title: string) =>
    one(
      sql<{ id: string; slug: string; name: string; legacy_id: string }[]>`
        select e.id, e.slug, e.name, le.id::text as legacy_id from legacy_yay.events le
        join legacy.ref r on r.instance = 'yay' and r.entity = 'events' and r.legacy_id = le.id::text
        join events.events e on e.id = r.new_id
        where le.title = ${title}`,
      title,
    );
  const weekly = await event(DEMO.eventTitle);
  const gala = await event(DEMO.pastEventTitle);
  const order = await one(
    sql<{ id: string; org_id: string; manage_token_ciphertext: string; common_order: string }[]>`
      select o.id, o.org_id, o.manage_token_ciphertext, b.common_order from legacy_yay.bookings b
      join legacy.ref r on r.instance = 'yay' and r.entity = 'orders'
        and r.legacy_id = b.common_order || '|' || b.event_id || '|' || b.customer_id
      join orders.orders o on o.id = r.new_id
      where b.customer_email = ${DEMO.buyerEmail} and b.event_id::text = ${weekly.legacy_id}
      order by b.id limit 1`,
    'demo buyer order',
  );
  const token = new TextDecoder().decode(
    await keyVault().decrypt(order.org_id, order.manage_token_ciphertext),
  );
  const scans: Record<string, { name: string; legacyCode: string; shortCode: string }> = {};
  for (const b of DEMO.scanBuyers) {
    const row = await one(
      sql<{ order_number: string; short_code: string; holder_name: string }[]>`
        select b.order_number, t.short_code, t.holder_name from legacy_yay.bookings b
        join legacy.ref r on r.instance = 'yay' and r.entity = 'bookings' and r.legacy_id = b.id::text
        join ticketing.tickets t on t.id = r.new_id
        where b.customer_email = ${b.email} and b.event_id::text = ${weekly.legacy_id}
        order by b.id limit 1`,
      `scan ticket for ${b.project}`,
    );
    scans[b.project] = { name: row.holder_name, legacyCode: row.order_number, shortCode: row.short_code };
  }
  const staff = await sql<{ email: string; role: string }[]>`
    select u.email, m.role from tenancy.memberships m join auth.users u on u.id = m.user_id
    where m.org_id = ${org.id} and m.role <> 'owner' order by m.role`;
  return {
    note: 'SYNTHETIC TEST DATA ONLY — written by migrate:legacy:demo for the e2e suite',
    owner: { email: DEMO.ownerEmail, password: SYNTH_PASSWORD, name: DEMO.ownerName },
    staff,
    org: { slug: org.slug, name: org.name },
    weekly: { slug: weekly.slug, name: weekly.name },
    gala: { slug: gala.slug, name: gala.name },
    buyer: { name: DEMO.buyerName, email: DEMO.buyerEmail, orderId: order.id, manageToken: token },
    scans,
  };
}
