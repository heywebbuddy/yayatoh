import { closePools } from '@yayatoh/db';
import { createEventCommand, getEventBySlugQuery, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { addMemberCommand, createOrganization, resolveOrgSlug } from '@yayatoh/tenancy';
import { DEMO_EVENTS } from '../src/demo/events.ts';
import { getAuth } from '../src/server/auth.ts';
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

for (const o of SEED_ORGS) {
  if (await resolveOrgSlug(o.slug)) {
    console.info(`seed: ${o.slug} exists`);
    continue;
  }
  const [owner, ...others] = PERSONAS.filter((p) => p.orgSlug === o.slug);
  const ownerId = owner && ids.get(owner.email);
  if (!ownerId) continue;
  const ownerCtx = createCtx({ actor: { type: 'user', userId: ownerId } });
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
await closePools();
