import { createEntryCommand, setEntryStatusCommand } from '@yayatoh/cms';
import { closePools, sql, withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { getAuth } from '../src/server/auth.ts';
import { log, owner, run } from './demo/kit.ts';

/*
 * Demo blog posts of one organization: 3 published posts written by its owner through the cms
 * commands, shown on its organizer page `/organizers/{slug}/blogs`.
 *
 * The platform blog and testimonials (admin-panel content, written through platform_reader) are
 * seeded by `apps/worker/scripts/demo-platform-content.ts` (`pnpm --filter @yayatoh/worker
 * demo-platform-content`).
 *
 * Idempotent: a post is skipped when the organization already has one with the same title.
 *
 *   DEMO_ORG_SLUG=webbuddy DEMO_OWNER_EMAIL=ratnesh@webbuddy.agency \
 *   node --conditions=react-server scripts/demo-content.ts
 *
 * Run it on the live database only on purpose: point DATABASE_URL at it (the Railway variable), run
 * the command above from a checkout of the deployed commit, and read the output ("created" / "kept").
 */
const slug = process.env.DEMO_ORG_SLUG;
const ownerEmail = process.env.DEMO_OWNER_EMAIL?.toLowerCase();
if (!slug || !ownerEmail) throw new Error('Set DEMO_ORG_SLUG and DEMO_OWNER_EMAIL');

const resolved = await resolveOrgSlug(slug);
if (!resolved) throw new Error(`No organization ${slug}`);
const user = await (await getAuth().$context).internalAdapter.findUserByEmail(ownerEmail);
if (!user) throw new Error(`No user ${ownerEmail}`);
const d = {
  orgId: resolved.orgId,
  ownerId: user.user.id,
  timezone: 'UTC',
  currency: 'USD',
  attendeeEmail: () => '',
};

const ORG_POSTS = [
  {
    title: 'Behind the scenes of our summer line-up',
    excerpt: 'How we picked the artists, the venue and the date.',
    body: '## Picking the artists\n\nWe listen for a month before we book anyone.\n\n## The venue\n\nA **waterfront hall** with room for 600 people and great sound.',
  },
  {
    title: 'What we learned running 30 events this year',
    excerpt: 'Three things that went wrong, and what we changed.',
    body: '## 1. Doors open too late\n\nWe now open **45 minutes** before the start.\n\n## 2. Not enough signs\n\nEvery corridor gets a sign.\n\n## 3. Slow refunds\n\nWe moved refunds to the same day.',
  },
  {
    title: 'Announcing our autumn community days',
    excerpt: 'Free and low-cost days on the coast, open to everyone.',
    body: 'Join us for **three community days** this autumn: food, music and workshops for all ages.\n\n- Free entry for children\n- Local makers market\n- Evening concert',
  },
] as const;

for (const p of ORG_POSTS) {
  const existing = await withTenant(
    createCtx({ orgId: d.orgId, actor: { type: 'system', name: 'demo-content' } }),
    (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from cms.entries where kind = 'post' and title = ${p.title}`,
      ),
  );
  if (Number(existing[0]?.n) > 0) {
    log(`org post "${p.title}": kept`);
    continue;
  }
  const entry = await run<unknown, { id: string }>(
    createEntryCommand,
    { kind: 'post', title: p.title, excerpt: p.excerpt, body: p.body, authorName: 'WebBuddy team' },
    owner(d),
  );
  await run(setEntryStatusCommand, { entryId: entry.id, action: 'publish' }, owner(d));
  log(`org post "${p.title}": created and published`);
}

log('demo content: done');
await closePools();
