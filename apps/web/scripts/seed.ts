import { devPersonaTotpSecret, secretKey, totp } from '@yayatoh/auth/totp';
import { closePools } from '@yayatoh/db';
import { createEventCommand, getEventBySlugQuery, transitionEventCommand } from '@yayatoh/events';
import { buildRoundTable, buildRow } from '@yayatoh/floorplan';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  assignSeatCategoryCommand,
  publishEventLayoutCommand,
  setEventLayoutCommand,
} from '@yayatoh/seating';
import {
  AGREEMENT_DOCUMENTS,
  acceptAgreementCommand,
  addMemberCommand,
  createOrganization,
  PLATFORM_AGREEMENTS,
  resolveOrgSlug,
} from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { DEMO_EVENTS } from '../src/demo/events.ts';
import { getAuth, getTwoFactor } from '../src/server/auth.ts';
import { PERSONAS, SEED_ORGS } from '../src/server/personas.ts';
import { ports } from '../src/server/ports.ts';

// Local/preview seed: persona users (Better Auth) and their orgs. Never production (CLAUDE.md → Safety).
const host = new URL(process.env.DATABASE_URL ?? 'postgres://localhost').hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host) && !process.env.SEED_ALLOW_PREVIEW) {
  throw new Error(`Refusing to seed ${host}; set SEED_ALLOW_PREVIEW=1 for a preview branch database`);
}
const password = process.env.DEV_PERSONA_PASSWORD;
if (!password || password.length < 12)
  throw new Error('Set DEV_PERSONA_PASSWORD (≥12 chars) to seed personas');

const auth = getAuth();
const ctx = await auth.$context;
const ids = new Map<string, string>();
for (const p of PERSONAS) {
  const existing = await ctx.internalAdapter.findUserByEmail(p.email);
  if (existing) {
    ids.set(p.email, existing.user.id);
    continue;
  }
  const res = await auth.api.signUpEmail({ body: { email: p.email, password, name: p.name } });
  ids.set(p.email, res.user.id);
  console.info(`seed: user ${p.email}`);
}

// Two-step verification for the personas that need it (owners, M1.2c), with a dev-only secret
// derived from DEV_PERSONA_PASSWORD so /dev/login and the e2e suite can answer the challenge.
const twoFactor = getTwoFactor();
for (const p of PERSONAS) {
  const userId = ids.get(p.email);
  if (!p.twoFactor || !userId || (await twoFactor.status(userId)).enabled) continue;
  const secret = devPersonaTotpSecret(p.email, password);
  await twoFactor.begin(userId, p.email, { secret });
  await twoFactor.confirm(userId, totp(secretKey(secret), Date.now()));
  console.info(`seed: two-step verification for ${p.email}`);
}

for (const o of SEED_ORGS) {
  if (await resolveOrgSlug(o.slug)) {
    console.info(`seed: ${o.slug} exists`);
    continue;
  }
  const [owner, ...others] = PERSONAS.filter((p) => p.orgSlug === o.slug);
  const ownerId = owner && ids.get(owner.email);
  if (!ownerId) continue;
  // A trusted script acting as the owner who just signed in (fresh for step-up commands).
  const ownerCtx = createCtx({ actor: { type: 'user', userId: ownerId }, stepUpAt: new Date() });
  const org = await createOrganization(
    ownerCtx,
    { slug: o.slug, name: o.name, defaultProfile: o.profile },
    ports,
  );
  for (const p of others) {
    const userId = ids.get(p.email);
    if (userId)
      await executeCommand(addMemberCommand, { userId, role: p.role }, { ...ownerCtx, orgId: org.id }, ports);
  }
  console.info(`seed: created ${o.slug}`);
}

// The owners accept the platform's current (draft) terms, so seeded orgs can publish.
for (const o of SEED_ORGS) {
  const owner = PERSONAS.find((p) => p.orgSlug === o.slug && p.role === 'owner');
  const ownerId = owner && ids.get(owner.email);
  const org = await resolveOrgSlug(o.slug);
  if (!ownerId || !org) continue;
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'user', userId: ownerId } });
  for (const document of AGREEMENT_DOCUMENTS)
    await executeCommand(
      acceptAgreementCommand,
      { document, version: PLATFORM_AGREEMENTS[document].version },
      ctx,
      ports,
    );
}

// Real events for the showcase slugs (the dev overlay adds demo sales on top of these).
for (const d of DEMO_EVENTS) {
  const owner = PERSONAS.find((p) => p.orgSlug === d.orgSlug && p.role === 'owner');
  const ownerId = owner && ids.get(owner.email);
  const org = await resolveOrgSlug(d.orgSlug);
  if (!ownerId || !org) continue;
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'user', userId: ownerId } });
  const exists = await executeQuery(getEventBySlugQuery, { slug: d.slug }, ctx, ports).catch(() => null);
  if (exists) continue;
  const e = await executeCommand(
    createEventCommand,
    {
      name: d.name,
      slug: d.slug,
      tagline: d.tagline,
      profile: d.profile,
      visibility: d.profile === 'wedding' ? 'private' : 'public',
      timezone: d.timezone,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      venueName: d.venue,
      city: d.city,
      currency: d.currency,
    },
    ctx,
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, ctx, ports);
  console.info(`seed: event ${d.slug}`);
}

// A plain published event with no demo overlay: purchase flows (and e2e) run against real data here.
{
  const owner = PERSONAS.find((p) => p.orgSlug === 'lakeside-events' && p.role === 'owner');
  const ownerId = owner && ids.get(owner.email);
  const org = await resolveOrgSlug('lakeside-events');
  if (ownerId && org) {
    const ctx = createCtx({ orgId: org.orgId, actor: { type: 'user', userId: ownerId } });
    const slug = 'lakeside-open-house';
    const exists = await executeQuery(getEventBySlugQuery, { slug }, ctx, ports).catch(() => null);
    if (!exists) {
      const e = await executeCommand(
        createEventCommand,
        {
          name: 'Lakeside Open House',
          slug,
          tagline: 'Meet the team behind Lakeside Events.',
          timezone: 'America/Chicago',
          startsAt: '2027-06-10T22:00:00Z',
          endsAt: '2027-06-11T01:00:00Z',
          city: 'Chicago',
          currency: 'USD',
        },
        ctx,
        ports,
      );
      await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, ctx, ports);
      console.info(`seed: event ${slug}`);
    }
  }
}
// A seated event (M1.7c): three rows sold as "Stalls", two tables as "Table", plus standing room.
{
  const owner = PERSONAS.find((p) => p.orgSlug === 'lakeside-events' && p.role === 'owner');
  const ownerId = owner && ids.get(owner.email);
  const org = await resolveOrgSlug('lakeside-events');
  if (ownerId && org) {
    const ctx = createCtx({ orgId: org.orgId, actor: { type: 'user', userId: ownerId } });
    const slug = 'lakeside-jazz-night';
    const exists = await executeQuery(getEventBySlugQuery, { slug }, ctx, ports).catch(() => null);
    if (!exists) {
      const e = await executeCommand(
        createEventCommand,
        {
          name: 'Lakeside Jazz Night',
          slug,
          tagline: 'An evening of jazz by the water. Choose your seat.',
          timezone: 'America/Chicago',
          startsAt: '2027-07-16T00:00:00Z',
          endsAt: '2027-07-16T03:00:00Z',
          venueName: 'Harbor Hall',
          city: 'Chicago',
          currency: 'USD',
        },
        ctx,
        ports,
      );
      const type = (name: string, priceMinor: number, quantityTotal: number) =>
        executeCommand(
          createTicketTypeCommand,
          { eventId: e.id, name, priceMinor, quantityTotal },
          ctx,
          ports,
        );
      const stalls = await type('Stalls', 3500, 60);
      const table = await type('Table', 6000, 16);
      await type('Standing', 2000, 100);
      const rows = ['A', 'B', 'C'].map((label, i) => buildRow({ label, count: 20, x: 200, y: 400 + i * 80 }));
      const tables = ['1', '2'].map((label, i) =>
        buildRoundTable({ label, seats: 8, x: 500 + i * 600, y: 900 }),
      );
      await executeCommand(
        setEventLayoutCommand,
        { eventId: e.id, doc: { version: 1, width: 1600, height: 1200, items: [...rows, ...tables] } },
        ctx,
        ports,
      );
      await executeCommand(
        assignSeatCategoryCommand,
        { eventId: e.id, itemIds: rows.map((r) => r.id), ticketTypeId: stalls.id },
        ctx,
        ports,
      );
      await executeCommand(
        assignSeatCategoryCommand,
        { eventId: e.id, itemIds: tables.map((t) => t.id), ticketTypeId: table.id },
        ctx,
        ports,
      );
      await executeCommand(publishEventLayoutCommand, { eventId: e.id }, ctx, ports);
      await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, ctx, ports);
      console.info(`seed: event ${slug}`);
    }
  }
}
await closePools();
