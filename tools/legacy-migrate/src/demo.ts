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
  // The gala's migrated seat chart (the legacy image chart → a floor plan with sold seats).
  const plan = await one(
    sql<{ total: number; sold: number; blocked: number; status: string; doc: unknown; layout: string }[]>`
      select (select count(*)::int from seating.event_seats s where s.event_id = l.event_id) as total,
             (select count(*)::int from seating.event_seats s where s.event_id = l.event_id and s.status = 'sold') as sold,
             (select count(*)::int from seating.event_seats s where s.event_id = l.event_id and s.status = 'blocked') as blocked,
             l.status, l.doc, (select name from seating.layouts where id = l.source_layout_id) as layout
      from seating.event_layouts l join events.events e on e.id = l.event_id
      where e.slug = ${gala.slug}`,
    'gala seat plan',
  );
  const legacySeats = await sql<{ name: string; coordinates: string; capacity: number }[]>`
    select s.name, s.coordinates, s.capacity::int as capacity from legacy_yay.seats s
    join legacy_yay.seatcharts c on c.id = s.seatchart_id
    where c.event_id::text = ${gala.legacy_id} order by s.id`;
  // Legacy URLs on the marketplace host (the demo run loads yay's redirects for yayatoh.localhost).
  const urls = await sql<{ path: string; planned_status: number; target: string | null; kind: string }[]>`
    select path, planned_status, target, kind from legacy.url_inventory
    where instance = 'yay' and host = 'yayatoh.localhost' order by kind, path`;
  const orgUrl = urls.find((u) => u.kind === 'organizer' && u.target === `/o/${org.slug}`);
  const renamed = urls.find((u) => u.kind === 'event' && u.planned_status === 308);
  const unchanged = urls.find((u) => u.kind === 'event' && u.planned_status === 200);
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
    seating: {
      total: plan.total,
      sold: plan.sold,
      blocked: plan.blocked,
      status: plan.status,
      layout: plan.layout,
      doc: plan.doc,
      legacySeats,
    },
    urls: {
      host: 'yayatoh.localhost',
      organizer: orgUrl ? { path: orgUrl.path, target: orgUrl.target } : null,
      renamedEvent: renamed ? { path: renamed.path, target: renamed.target } : null,
      unchangedEvent: unchanged ? { path: unchanged.path } : null,
    },
  };
}

/**
 * The e2e dataset starts from a freshly migrated owner each time (legacy accounts never had
 * two-step verification): a rerun on a used database clears what an earlier e2e run set up, and
 * signs the synthetic owner out everywhere. Synthetic demo data only.
 */
export async function resetDemoOwner(): Promise<void> {
  const sql = migratorSql();
  await sql`delete from auth.two_factors t using auth.users u where t.user_id = u.id and u.email = ${DEMO.ownerEmail}`;
  await sql`delete from auth.sessions s using auth.users u where s.user_id = u.id and u.email = ${DEMO.ownerEmail}`;
  await sql`update auth.users set two_factor_enabled = false where email = ${DEMO.ownerEmail}`;
}
