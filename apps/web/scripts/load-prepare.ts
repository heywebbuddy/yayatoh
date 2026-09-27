import { mkdirSync, writeFileSync } from 'node:fs';
import { enrollDeviceCommand } from '@yayatoh/checkin';
import { closePools, withTenant } from '@yayatoh/db';
import { createEventCommand, getEventBySlugQuery, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { createTicketTypeCommand, listTicketTypesQuery, ticketsForOrderTx } from '@yayatoh/ticketing';
import { getAuth } from '../src/server/auth.ts';
import { ports } from '../src/server/ports.ts';

/**
 * Load-test data for k6 (M1.14d): a published "Load test" event in Lakeside happening now, a free
 * high-capacity ticket type, issued tickets to scan, and a scanner device token. Writes
 * `k6/.data/load.json` (gitignored). Local databases only, like the seed.
 */
const host = new URL(process.env.DATABASE_URL ?? 'postgres://localhost').hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host)) throw new Error(`Refusing to prepare ${host}`);

const TICKETS = Number(process.env.LOAD_TICKETS ?? 2000);
const auth = getAuth();
const owner = await (await auth.$context).internalAdapter.findUserByEmail('pani@lakeside.test');
const org = await resolveOrgSlug('lakeside-events');
if (!owner || !org) throw new Error('Run pnpm seed first');
const ctx = createCtx({ orgId: org.orgId, actor: { type: 'user', userId: owner.user.id } });
const slug = `load-test-${new Date().toISOString().slice(0, 10)}`;
let event = await executeQuery(getEventBySlugQuery, { slug }, ctx, ports).catch(() => null);
if (!event) {
  const now = Date.now();
  event = await executeCommand(
    createEventCommand,
    {
      name: 'Load test',
      slug,
      timezone: 'America/Chicago',
      startsAt: new Date(now + 60_000).toISOString(),
      endsAt: new Date(now + 12 * 3_600_000).toISOString(),
      city: 'Chicago',
      currency: 'USD',
    },
    ctx,
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: event.id, transition: 'publish' }, ctx, ports);
}
const types = await executeQuery(listTicketTypesQuery, { eventId: event.id }, ctx, ports);
const pass =
  types.find((t) => t.name === 'Load test pass') ??
  (await executeCommand(
    createTicketTypeCommand,
    { eventId: event.id, name: 'Load test pass', priceMinor: 0, quantityTotal: 1_000_000, maxPerOrder: 10 },
    ctx,
    ports,
  ));
const codes: string[] = [];
for (let i = 0; codes.length < TICKETS; i++) {
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId: event.id,
      items: [{ ticketTypeId: pass.id, quantity: 10 }],
      buyer: { email: `load+${i}@example.test`, name: `Load ${i}` },
      marketingOptIn: false,
    },
    createCtx({ orgId: org.orgId }),
    ports,
  );
  const issued = await withTenant(ctx, (tx) => ticketsForOrderTx(tx, r.order.id));
  codes.push(...issued.map((t) => t.shortCode));
}
const device = await executeCommand(enrollDeviceCommand, { label: `k6 ${Date.now()}` }, ctx, ports);
mkdirSync(new URL('../../../k6/.data/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../../../k6/.data/load.json', import.meta.url),
  JSON.stringify(
    { eventSlug: slug, eventId: event.id, ticketTypeId: pass.id, deviceToken: device.token, codes },
    null,
    2,
  ),
);
console.info(`load-prepare: ${slug}, ${codes.length} tickets, device token written to k6/.data/load.json`);
await closePools();
