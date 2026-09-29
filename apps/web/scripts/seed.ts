import { devPersonaTotpSecret, secretKey, totp } from '@yayatoh/auth/totp';
import { closePools } from '@yayatoh/db';
import { createEventCommand, getEventBySlugQuery, transitionEventCommand } from '@yayatoh/events';
import { buildRoundTable, buildRow } from '@yayatoh/floorplan';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { addLegacyRedirectCommand, catchUpListings, updateSiteSettingsCommand } from '@yayatoh/marketplace';
import { catchUpMetrics, rebuildOrgMetrics } from '@yayatoh/reports';
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
import { createVenueCommand, listVenuesQuery } from '@yayatoh/venues';
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
  const found = await resolveOrgSlug(o.slug);
  if (found) {
    // Personas added after the org was first seeded (e.g. finance, M1.6e) join it now.
    const owner = PERSONAS.find((p) => p.orgSlug === o.slug && p.role === 'owner');
    const ownerId = owner && ids.get(owner.email);
    for (const p of PERSONAS.filter((x) => x.orgSlug === o.slug && x.role !== 'owner')) {
      const userId = ids.get(p.email);
      if (!ownerId || !userId) continue;
      await executeCommand(
        addMemberCommand,
        { userId, role: p.role },
        createCtx({ orgId: found.orgId, actor: { type: 'user', userId: ownerId } }),
        ports,
      ).then(
        () => console.info(`seed: ${p.email} joined ${o.slug}`),
        () => undefined, // already a member
      );
    }
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
// Marketplace (M1.11): Harbor Arts, a public organizer with a tenant site and a full calendar;
// Lakeside and Harbor enrolled on the marketplace (D13: opt-in); sample legacy redirects.
{
  const owner = PERSONAS.find((p) => p.orgSlug === 'harbor-arts' && p.role === 'owner');
  const ownerId = owner && ids.get(owner.email);
  const org = await resolveOrgSlug('harbor-arts');
  if (ownerId && org) {
    const ctx = createCtx({ orgId: org.orgId, actor: { type: 'user', userId: ownerId } });
    const make = async (
      slug: string,
      name: string,
      extra: Record<string, unknown>,
      prices: number[],
      transitions: ('publish' | 'postpone' | 'cancel')[],
    ) => {
      const exists = await executeQuery(getEventBySlugQuery, { slug }, ctx, ports).catch(() => null);
      if (exists) return;
      const e = await executeCommand(
        createEventCommand,
        { name, slug, timezone: 'America/New_York', currency: 'USD', ...extra },
        ctx,
        ports,
      );
      for (const [i, priceMinor] of prices.entries())
        await executeCommand(
          createTicketTypeCommand,
          {
            eventId: e.id,
            name: i === 0 ? 'General admission' : `Tier ${i + 1}`,
            priceMinor,
            quantityTotal: 200,
          },
          ctx,
          ports,
        );
      for (const transition of transitions)
        await executeCommand(transitionEventCommand, { eventId: e.id, transition }, ctx, ports);
      console.info(`seed: event ${slug}`);
    };
    await make(
      'harbor-spring-concert',
      'Harbor Spring Concert',
      {
        profile: 'concert',
        tagline: 'Strings and brass on the river terrace.',
        venueName: 'River Terrace',
        city: 'New York',
        country: 'US',
        startsAt: '2027-05-20T23:00:00Z',
        endsAt: '2027-05-21T02:00:00Z',
      },
      [0],
      ['publish'],
    );
    await make(
      'harbor-film-night',
      'Harbor Film Night',
      {
        profile: 'community',
        tagline: 'Short films from Lagos and Paris, with the directors.',
        venueName: 'Cinéma du Port',
        city: 'Paris',
        country: 'FR',
        timezone: 'Europe/Paris',
        currency: 'EUR',
        startsAt: '2027-08-12T18:00:00Z',
        endsAt: '2027-08-12T21:00:00Z',
      },
      [1200, 2500],
      ['publish'],
    );
    await make(
      'harbor-autumn-gala',
      'Harbor Autumn Gala',
      {
        profile: 'gala',
        tagline: 'Our fundraising gala, moving to a new date.',
        venueName: 'Harbor House',
        city: 'Lagos',
        country: 'NG',
        timezone: 'Africa/Lagos',
        startsAt: '2027-10-02T18:00:00Z',
        endsAt: '2027-10-02T23:00:00Z',
      },
      [15000],
      ['publish', 'postpone'],
    );
    await make(
      'harbor-winter-show',
      'Harbor Winter Show',
      {
        profile: 'concert',
        city: 'New York',
        country: 'US',
        startsAt: '2027-12-12T23:00:00Z',
        endsAt: '2027-12-13T02:00:00Z',
      },
      [3000],
      ['publish', 'cancel'],
    );
    // A monthly workshop series: enough listings to page through.
    for (let m = 1; m <= 12; m += 1) {
      const mm = String(m).padStart(2, '0');
      await make(
        `harbor-workshop-2028-${mm}`,
        `Harbor Workshop ${mm}/2028`,
        {
          profile: 'other',
          venueName: 'Harbor Studio',
          city: 'New York',
          country: 'US',
          startsAt: `2028-${mm}-05T23:00:00Z`,
          endsAt: `2028-${mm}-06T01:00:00Z`,
        },
        [m % 3 === 0 ? 0 : 1800],
        ['publish'],
      );
    }
    await executeCommand(
      updateSiteSettingsCommand,
      { listOnMarketplace: true, tenantSite: true },
      ctx,
      ports,
    );
  }
  const lakeside = await resolveOrgSlug('lakeside-events');
  const lakesideOwner = ids.get('pani@lakeside.test');
  if (lakeside && lakesideOwner) {
    const ctx = createCtx({ orgId: lakeside.orgId, actor: { type: 'user', userId: lakesideOwner } });
    await executeCommand(updateSiteSettingsCommand, { listOnMarketplace: true }, ctx, ports);
  }
  // Root organizer URLs and a renamed event (roadmap §7.7), as the migration tooling will load them.
  const samples = [
    { org: 'lakeside-events', host: '*', source: '/lakeside-events', target: '/o/lakeside-events' },
    { org: 'harbor-arts', host: '*', source: '/harbor-arts', target: '/o/harbor-arts' },
    {
      org: 'harbor-arts',
      host: '*',
      source: '/events/harbor-concert-2027',
      target: '/events/harbor-spring-concert',
    },
    {
      org: 'harbor-arts',
      host: '*',
      source: '/organiser/harbor-arts',
      target: '/o/harbor-arts',
      match: 'prefix' as const,
    },
  ];
  for (const r of samples) {
    const o = await resolveOrgSlug(r.org);
    if (!o) continue;
    await executeCommand(
      addLegacyRedirectCommand,
      { host: r.host, source: r.source, target: r.target, match: r.match ?? 'exact' },
      createCtx({ orgId: o.orgId, actor: { type: 'system', name: 'seed' } }),
      ports,
    ).catch((err: { code?: string }) => {
      if (err.code !== 'conflict') throw err;
    });
  }
  // No worker in seed runs: apply the listings projector to every seeded org's outbox.
  for (const o of SEED_ORGS) {
    const found = await resolveOrgSlug(o.slug);
    if (found) console.info(`seed: ${await catchUpListings(found.orgId)} listing event(s) for ${o.slug}`);
    // M3.1 metric projections: apply the outbox, then rebuild from the sources (seeded rows too).
    if (found) {
      await catchUpMetrics(found.orgId);
      await rebuildOrgMetrics(found.orgId);
    }
  }
}
// A directory venue (M1.4c) so /venues has something to show; not attached to any seeded event.
{
  const owner = PERSONAS.find((p) => p.orgSlug === 'lakeside-events' && p.role === 'owner');
  const ownerId = owner && ids.get(owner.email);
  const org = await resolveOrgSlug('lakeside-events');
  if (ownerId && org) {
    const ctx = createCtx({ orgId: org.orgId, actor: { type: 'user', userId: ownerId } });
    const name = 'Lakeside Pavilion';
    const venues = await executeQuery(listVenuesQuery, { includeArchived: true }, ctx, ports);
    if (!venues.some((v) => v.name === name)) {
      await executeCommand(
        createVenueCommand,
        {
          name,
          addressLine1: '1600 N Lake Shore Dr',
          city: 'Chicago',
          region: 'IL',
          postalCode: '60613',
          country: 'US',
          latitude: 41.9116,
          longitude: -87.6264,
          timezone: 'America/Chicago',
          capacity: 450,
          accessibilityNotes:
            'Step-free entrance from the lakefront path; accessible restrooms on the ground floor.',
          mapUrl: 'https://www.openstreetmap.org/?mlat=41.9116&mlon=-87.6264',
          directoryListed: true,
        },
        ctx,
        ports,
      );
      console.info(`seed: venue ${name}`);
    }
  }
}
await closePools();
