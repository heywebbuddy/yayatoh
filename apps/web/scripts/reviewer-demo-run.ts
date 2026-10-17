import { randomBytes } from 'node:crypto';
import {
  enrollDeviceCommand,
  findTicketHoldersQuery,
  listDevicesQuery,
  setDeviceStateCommand,
} from '@yayatoh/checkin';
import { closePools } from '@yayatoh/db';
import { createEventCommand, getEventBySlugQuery, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { catchUpListings, updateSiteSettingsCommand } from '@yayatoh/marketplace';
import { startCheckoutCommand } from '@yayatoh/orders';
import {
  AGREEMENT_DOCUMENTS,
  acceptAgreementCommand,
  createOrganization,
  PLATFORM_AGREEMENTS,
  resolveOrgSlug,
} from '@yayatoh/tenancy';
import { createTicketTypeCommand, listTicketTypesQuery } from '@yayatoh/ticketing';
import { getAuth } from '../src/server/auth.ts';
import { ports } from '../src/server/ports.ts';

/**
 * The store reviewer demo (M7.5a): a demo organization with one running event, an attendee for App
 * Review to sign in as, a few door tickets and a Staff enrolment link.
 *
 *   pnpm reviewer-demo --target=local|staging [--rotate-door] [--base-url https://…]
 *
 * It is idempotent: a second run changes nothing (except `--rotate-door`, which revokes the demo
 * door device and enrols a new one, because a device token can be shown only once). It refuses
 * production in three ways (environment name, database host, payment provider; see
 * `reviewer-demo-guard.ts`) and runs only with the fake payment provider.
 *
 * It prints one JSON object on stdout: what to put in the review notes and the screenshot flows.
 * The sign-in code itself is not created here: the review server must run with REVIEWER_DEMO_EMAIL
 * and REVIEWER_DEMO_CODE set to the values printed, and `createAuth` honours them outside
 * production only.
 */

const flag = (name: string): string | undefined => {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  const i = process.argv.indexOf(hit);
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : '';
};

const ORG_SLUG = 'app-review-demo';
const EVENT_SLUG = 'app-review-concert';
const OWNER_EMAIL = 'app-review-organizer@yayatoh.test';
const REVIEWER_EMAIL = (process.env.REVIEWER_DEMO_EMAIL?.trim() || 'app-review@yayatoh.test').toLowerCase();
const REVIEWER_NAME = 'Rae Viewer';
const DOOR_LABEL = 'App Review door';
const DOOR_TICKETS_WANTED = 3;
const DAY_MS = 86_400_000;

const baseUrl = (flag('base-url') || process.env.BETTER_AUTH_URL || 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
const rotateDoor = process.argv.includes('--rotate-door');
const log = (msg: string) => console.error(`reviewer-demo: ${msg}`);

// 1. The demo organization's owner (never signs in; the password is random and thrown away).
const auth = getAuth();
const authCtx = await auth.$context;
let ownerId = (await authCtx.internalAdapter.findUserByEmail(OWNER_EMAIL))?.user.id;
if (!ownerId) {
  const res = await auth.api.signUpEmail({
    body: {
      email: OWNER_EMAIL,
      password: randomBytes(24).toString('base64url'),
      name: 'App Review Organizer',
    },
  });
  ownerId = res.user.id;
  log(`created ${OWNER_EMAIL}`);
}

// 2. The organization, with the platform terms accepted so its event can be published.
const found = await resolveOrgSlug(ORG_SLUG);
let orgId = found?.orgId;
if (!orgId) {
  const ownerCtx = createCtx({ actor: { type: 'user', userId: ownerId }, stepUpAt: new Date() });
  orgId = (
    await createOrganization(
      ownerCtx,
      { slug: ORG_SLUG, name: 'Yayatoh App Review Demo', defaultProfile: 'concert' },
      ports,
    )
  ).id;
  log(`created organization ${ORG_SLUG}`);
}
const ctx: Ctx = createCtx({ orgId, actor: { type: 'user', userId: ownerId } });
for (const document of AGREEMENT_DOCUMENTS)
  await executeCommand(
    acceptAgreementCommand,
    { document, version: PLATFORM_AGREEMENTS[document].version },
    ctx,
    ports,
  );

// 3. A running event: it began yesterday and ends in 180 days, so the door is open whenever the
// reviewer looks (a scan outside the event days is refused, which would look like a broken app).
let event = await executeQuery(getEventBySlugQuery, { slug: EVENT_SLUG }, ctx, ports).catch(() => null);
if (!event) {
  const now = Date.now();
  event = await executeCommand(
    createEventCommand,
    {
      name: 'App Review Concert',
      slug: EVENT_SLUG,
      tagline: 'A demo event for store reviewers. No real tickets, no real charges.',
      profile: 'concert',
      visibility: 'public',
      timezone: 'America/Chicago',
      startsAt: new Date(now - DAY_MS).toISOString(),
      endsAt: new Date(now + 180 * DAY_MS).toISOString(),
      venueName: 'Demo Hall',
      city: 'Chicago',
      currency: 'USD',
    },
    ctx,
    ports,
  );
  await executeCommand(
    createTicketTypeCommand,
    { eventId: event.id, name: 'General admission', priceMinor: 2500, quantityTotal: 500 },
    ctx,
    ports,
  );
  await executeCommand(
    createTicketTypeCommand,
    { eventId: event.id, name: 'Reviewer pass', priceMinor: 0, quantityTotal: 100 },
    ctx,
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: event.id, transition: 'publish' }, ctx, ports);
  log(`created event ${EVENT_SLUG}`);
}
const eventId = event.id;

// 4. Listed on the marketplace, so Discover in the app finds it.
await executeCommand(updateSiteSettingsCommand, { listOnMarketplace: true }, ctx, ports);
await catchUpListings(orgId);

// 5. Tickets. Buying by email is how a person gets tickets before they have an account: the
// reviewer's account (created at first sign-in with the code) sees them in My tickets.
const types = await executeQuery(listTicketTypesQuery, { eventId }, ctx, ports);
const freePass = types.find((t: { name: string }) => t.name === 'Reviewer pass');
if (!freePass) throw new Error('The demo event lost its "Reviewer pass" ticket type');

/** The active tickets held by an address (the door's own lookup by email: exact match). */
const ticketsOf = async (email: string) =>
  (await executeQuery(findTicketHoldersQuery, { eventId, query: email }, ctx, ports)).matches.filter(
    (m) => m.status === 'active',
  );
const issue = (email: string, name: string) =>
  executeCommand(
    startCheckoutCommand,
    { eventId, items: [{ ticketTypeId: freePass.id, quantity: 1 }], buyer: { email, name } },
    createCtx({ orgId }),
    ports,
  );

if ((await ticketsOf(REVIEWER_EMAIL)).length === 0) {
  await issue(REVIEWER_EMAIL, REVIEWER_NAME);
  log(`issued the reviewer's ticket to ${REVIEWER_EMAIL}`);
}
const reviewerTicket = (await ticketsOf(REVIEWER_EMAIL))[0];

// Door tickets for Staff: people at the "door" who have not been admitted yet. Enough stay unused
// for the reviewer to scan one and then scan it again to see the repeat.
const doorEmail = (n: number) => `app-review-door-${n}@yayatoh.test`;
const doorName = (n: number) => `Dana Door ${n}`;
const door: { code: string; holder: string }[] = [];
for (let n = 1; n <= 50 && door.length < DOOR_TICKETS_WANTED; n++) {
  let rows = await ticketsOf(doorEmail(n));
  if (rows.length === 0) {
    await issue(doorEmail(n), doorName(n));
    rows = await ticketsOf(doorEmail(n));
    log(`issued a door ticket to ${doorEmail(n)}`);
  }
  const open = rows.find((r) => !r.admittedToday);
  if (open) door.push({ code: open.shortCode, holder: doorName(n) });
}

// 6. The door device. A token is shown once, so an existing one is kept (and not printed) unless
// `--rotate-door` replaces it.
const devices = await executeQuery(listDevicesQuery, {}, ctx, ports);
const live = devices.filter((d: { label: string; revoked: boolean }) => d.label === DOOR_LABEL && !d.revoked);
let enrolLink: string | null = null;
if (live.length === 0 || rotateDoor) {
  for (const d of live)
    await executeCommand(setDeviceStateCommand, { deviceId: d.id, action: 'revoke' }, ctx, ports);
  const enrolled = await executeCommand(
    enrollDeviceCommand,
    { label: DOOR_LABEL, assignedUserId: null },
    ctx,
    ports,
  );
  enrolLink = `${baseUrl}/scan#e=${eventId}&k=${encodeURIComponent(enrolled.token)}`;
  log(live.length > 0 ? 'rotated the door device' : 'enrolled the door device');
}

const out = {
  organization: ORG_SLUG,
  event: { id: eventId, slug: EVENT_SLUG, name: 'App Review Concert' },
  attendee: {
    email: REVIEWER_EMAIL,
    name: REVIEWER_NAME,
    ticketShortCode: reviewerTicket?.shortCode ?? null,
    note: 'Sign in with the email code. The server needs REVIEWER_DEMO_EMAIL and REVIEWER_DEMO_CODE set (six digits, non-production only).',
    codeIsFixedOnThisServer:
      process.env.REVIEWER_DEMO_EMAIL?.trim().toLowerCase() === REVIEWER_EMAIL &&
      /^\d{6}$/.test(process.env.REVIEWER_DEMO_CODE ?? ''),
  },
  staff: {
    enrolEvent: eventId,
    enrolLink,
    enrolLinkNote: enrolLink
      ? 'Shown once. Put it in REVIEW_STAFF_ENROL_LINK; re-run with --rotate-door for a new one.'
      : 'The door device already exists (token not shown). Re-run with --rotate-door to enrol a new one.',
    doorTickets: door,
  },
};
console.info(JSON.stringify(out, null, 2));
await closePools();
