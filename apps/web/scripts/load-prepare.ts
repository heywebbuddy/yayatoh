import { mkdirSync, writeFileSync } from 'node:fs';
import { bearerSessions } from '@yayatoh/auth';
import { enrollDeviceCommand, listDevicesQuery, setDeviceStateCommand } from '@yayatoh/checkin';
import { closePools, withTenant } from '@yayatoh/db';
import { createEventCommand, getEventBySlugQuery, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { guestOrders, setCheckoutSettingsCommand, startCheckoutCommand } from '@yayatoh/orders';
import { createApiKeyCommand, resolveOrgSlug } from '@yayatoh/tenancy';
import { createTicketTypeCommand, listTicketTypesQuery, ticketsForOrderTx } from '@yayatoh/ticketing';
import { getAuth } from '../src/server/auth.ts';
import { ports } from '../src/server/ports.ts';

/**
 * Load-test data for k6 (M1.14d): a published "Load test" event in Lakeside happening now, a free
 * high-capacity ticket type, issued tickets to scan, and a scanner device token. Writes
 * `k6/.data/load.json` (gitignored). Local databases only, like the seed.
 *
 * M7.x adds what the mobile apps' scripts need:
 * - `LOAD_ATTENDEES` (default 200) attendee accounts `load-attendee-<i>@example.test` with a
 *   verified email, an order of two tickets for the load event and a bearer access token each
 *   (`k6/me-tickets.js`, `k6/app-checkout.js`). Access tokens live 15 minutes: the scripts sign in
 *   again with `attendeePassword` when the prepared tokens are about to lapse.
 * - `LOAD_DEVICES` (default 500) enrolled Staff devices, a token each (`k6/staff-heartbeat.js`,
 *   `k6/scan-batch-peak.js`). Devices a previous run enrolled (label `k6 …`) are revoked first so
 *   the device board of the load event only lists this run's.
 */
const host = new URL(process.env.DATABASE_URL ?? 'postgres://localhost').hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host)) throw new Error(`Refusing to prepare ${host}`);

const TICKETS = Number(process.env.LOAD_TICKETS ?? 2000);
const ATTENDEES = Number(process.env.LOAD_ATTENDEES ?? 200);
const DEVICES = Number(process.env.LOAD_DEVICES ?? 500);
// Local databases only (guard above), so a fixed password for the throwaway attendee accounts is fine.
const attendeePassword = process.env.LOAD_ATTENDEE_PASSWORD ?? 'k6-load-attendee-password';
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
// M1.5f: the checkout profile measures holding and paying; its buyers can't read emailed codes, so
// the load event turns the buyer email check off (the code step is rate limited on its own).
await executeCommand(setCheckoutSettingsCommand, { eventId: event.id, verifyEmail: false }, ctx, ports);
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
// M7.x: staff devices. Last run's are revoked so the load event's device board only lists these.
for (const d of await executeQuery(listDevicesQuery, {}, ctx, ports)) {
  if (d.label.startsWith('k6 ') && !d.revoked)
    await executeCommand(setDeviceStateCommand, { deviceId: d.id, action: 'revoke' }, ctx, ports);
}
const device = await executeCommand(enrollDeviceCommand, { label: `k6 ${Date.now()}` }, ctx, ports);

/** Run `fn` over `0..n-1`, `width` at a time (accounts hash passwords: keep the CPU busy, not drowned). */
async function inChunks<T>(n: number, width: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < n; i += width) {
    const chunk = Array.from({ length: Math.min(width, n - i) }, (_, k) => fn(i + k));
    out.push(...(await Promise.all(chunk)));
  }
  return out;
}

const deviceTokens = await inChunks(DEVICES, 20, async (i) => {
  const d = await executeCommand(enrollDeviceCommand, { label: `k6 device ${i}` }, ctx, ports);
  return d.token;
});

// M7.x: attendee accounts with a verified email, two tickets each, and a bearer access token.
const authCtx = await auth.$context;
const sessions = bearerSessions(auth);
const attendees = await inChunks(ATTENDEES, 8, async (i) => {
  const email = `load-attendee-${i}@example.test`;
  const existing = await authCtx.internalAdapter.findUserByEmail(email);
  let userId = existing?.user.id;
  if (!userId) {
    const made = await auth.api.signUpEmail({
      body: { email, password: attendeePassword, name: `Load Attendee ${i}` },
    });
    userId = made.user.id;
  }
  if (!existing?.user.emailVerified)
    await authCtx.internalAdapter.updateUser(userId, { emailVerified: true });
  if (!(await guestOrders(email, null)).some((o) => o.eventId === event.id)) {
    await executeCommand(
      startCheckoutCommand,
      {
        eventId: event.id,
        items: [{ ticketTypeId: pass.id, quantity: 2 }],
        buyer: { email, name: `Load Attendee ${i}` },
        marketingOptIn: false,
      },
      createCtx({ orgId: org.orgId }),
      ports,
    );
  }
  const signedIn = await sessions.signInForTokens(email, attendeePassword);
  if (!signedIn.ok)
    throw new Error(
      `Cannot sign in ${email} (${signedIn.reason}); set LOAD_ATTENDEE_PASSWORD to its password`,
    );
  return {
    email,
    accessToken: signedIn.tokens.accessToken,
    expiresAt: signedIn.tokens.accessTokenExpiresAt.getTime(),
  };
});
// M6.x: /v1 keys for `api-limits.js` (a live key and a test key, read-only scopes, fresh each run).
const stepUp = createCtx({
  orgId: org.orgId,
  actor: { type: 'user', userId: owner.user.id },
  stepUpAt: new Date(),
});
const liveKey = await executeCommand(
  createApiKeyCommand,
  { name: `k6 live ${Date.now()}`, scopes: ['org:read'] },
  stepUp,
  ports,
);
const testKey = await executeCommand(
  createApiKeyCommand,
  { name: `k6 test ${Date.now()}`, scopes: ['org:read'], mode: 'test' },
  stepUp,
  ports,
);
mkdirSync(new URL('../../../k6/.data/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../../../k6/.data/load.json', import.meta.url),
  JSON.stringify(
    {
      eventSlug: slug,
      eventId: event.id,
      ticketTypeId: pass.id,
      deviceToken: device.token,
      deviceTokens,
      attendeePassword,
      attendees,
      orgSlug: 'lakeside-events',
      liveKey: liveKey.key,
      testKey: testKey.key,
      codes,
    },
    null,
    2,
  ),
);
console.info(
  `load-prepare: ${slug}, ${codes.length} tickets, ${attendees.length} attendees, ${deviceTokens.length} devices written to k6/.data/load.json`,
);
await closePools();
