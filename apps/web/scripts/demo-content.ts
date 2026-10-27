import { createHash } from 'node:crypto';
import { createEntryCommand, setEntryStatusCommand } from '@yayatoh/cms';
import { closePools, sql, withTenant } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { createCtx } from '@yayatoh/kernel';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { getAuth } from '../src/server/auth.ts';
import { demoImage, log, owner, PALETTES, run } from './demo/kit.ts';

/*
 * Demo content for the platform blog, testimonials and an organization's blog.
 *
 *   - 5 platform blog posts with cover images and 6 testimonials with photos and ratings, written
 *     the way the admin console does (cms.platform_* functions through platform_reader, actor
 *     `staff:demo-seed`, every call in the access log);
 *   - 3 published blog posts of one organization (its owner writes them through the cms commands),
 *     shown on its organizer page `/organizers/{slug}/blogs`.
 *
 * Idempotent: a post is skipped when its slug exists, a testimonial when the same name and quote
 * exist. Re-running adds nothing. Needs a database where migrations are applied.
 *
 *   DEMO_ORG_SLUG=webbuddy DEMO_OWNER_EMAIL=ratnesh@webbuddy.agency \
 *   node --conditions=react-server scripts/demo-content.ts
 *
 * Run it on the live database only on purpose: point the DATABASE_URL / PLATFORM_READER_DATABASE_URL
 * variables of that environment at it (the Railway variables), run the command above from a
 * checkout of the deployed commit, and read the output ("created" / "kept" per item).
 */
const slug = process.env.DEMO_ORG_SLUG;
const ownerEmail = process.env.DEMO_OWNER_EMAIL?.toLowerCase();
if (!slug || !ownerEmail) throw new Error('Set DEMO_ORG_SLUG and DEMO_OWNER_EMAIL');

setPlatformAuditSink(databaseAuditSink);
const ACTOR = 'staff:demo-seed';
const platform = <T>(reason: string, fn: Parameters<typeof withPlatformReader<T>>[1], write = true) =>
  withPlatformReader({ actor: ACTOR, reason: `demo content: ${reason}` }, fn, {
    callsWritingFunctions: write,
  });

async function asset(seed: string, palette: readonly string[], w: number, h: number): Promise<string> {
  const bytes = await demoImage(seed, palette, w, h);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const [row] = await platform(`store image ${seed}`, (tx) =>
    tx.execute<{ id: string }>(
      sql`select cms.platform_store_asset('image', 'image/jpeg', ${Buffer.from(bytes)}::bytea, ${sha}, ${ACTOR}) as id`,
    ),
  );
  return String(row?.id);
}

const POSTS = [
  {
    slug: 'welcome-to-yayatoh',
    title: 'Welcome to Yayatoh',
    excerpt: 'Ticketing, check-in and community tools for events of every size, in one place.',
    palette: PALETTES.concert,
    body: '## One home for your events\n\nYayatoh helps organizers **sell tickets**, welcome guests and keep their community together.\n\n- Beautiful event pages\n- Fast, reliable check-in\n- Sponsors, speakers and exhibitors in one place\n\nStart with a free event and grow from there.',
  },
  {
    slug: 'how-to-run-a-smooth-check-in',
    title: 'How to run a smooth check-in',
    excerpt: 'Five habits that keep the door line short, from badges to scanner placement.',
    palette: PALETTES.conference,
    body: '## Before doors open\n\n1. Send each guest their ticket the day before.\n2. Print badges for sponsors and speakers in advance.\n3. Test every scanner on the venue Wi-Fi.\n\n## At the door\n\nSplit the line by ticket type and keep one **help desk** for lost tickets.',
  },
  {
    slug: 'selling-out-your-first-event',
    title: 'Selling out your first event',
    excerpt: 'Pricing, early-bird tickets and a launch plan that works for small teams.',
    palette: PALETTES.gala,
    body: '## Price with intent\n\nOffer an *early-bird* tier for the first 20% of tickets, then raise the price in steps.\n\n## Tell people why\n\nA clear lineup, a real venue and a face behind the event build trust faster than discounts.',
  },
  {
    slug: 'sponsors-that-come-back',
    title: 'Sponsors that come back every year',
    excerpt: 'What sponsors actually want to see in a report, and how to deliver it.',
    palette: PALETTES.agency,
    body: '## Give them numbers\n\nSend leads, booth visits and attendance within a week.\n\n## Give them stories\n\nA short **video** and two quotes from attendees do more than a long deck.',
  },
  {
    slug: 'hybrid-events-without-the-headaches',
    title: 'Hybrid events without the headaches',
    excerpt: 'Run an in-person day and an online audience from the same ticket list.',
    palette: PALETTES.community,
    body: '## One ticket list\n\nOnline guests get a join link instead of a seat. Everyone appears in the same attendee list.\n\n## Keep chat open\n\nA lobby chat keeps remote and on-site guests talking to each other.',
  },
] as const;

const QUOTES = [
  ['Yayatoh made our conference check-in painless.', 'Asha Rao', 'Director, DevCon India', 5, '#2a9d8f'],
  [
    'We sold out in nine days, and the sponsor pages looked great.',
    'Marcus Lee',
    'Head of Events, Northwind Cloud',
    5,
    '#264653',
  ],
  [
    'Our community finally has one place for tickets and updates.',
    'Fatima Haddad',
    'Founder, Studio Meridian',
    4,
    '#e76f51',
  ],
  [
    'Setting up a three-day wedding with RSVPs took one afternoon.',
    'Priya Venkatesh',
    'Wedding planner',
    5,
    '#e9c46a',
  ],
  [
    'The speaker portal saved us hundreds of emails.',
    'Kenji Watanabe',
    'Program chair, OSS Asia',
    5,
    '#457b9d',
  ],
  [
    'Simple, fast and honest pricing. Exactly what a small team needs.',
    'Sarah Okafor',
    'Community lead',
    4,
    '#6a4c93',
  ],
] as const;

// ---- platform blog posts and testimonials
for (const [i, p] of POSTS.entries()) {
  const [exists] = await platform(
    `look for post ${p.slug}`,
    (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from cms.platform_posts where slug = ${p.slug}`,
      ),
    false,
  );
  if (Number(exists?.n) > 0) {
    log(`platform post ${p.slug}: kept`);
    continue;
  }
  const cover = await asset(`post-${p.slug}`, p.palette, 1600, 900);
  const payload = JSON.stringify({
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    body: p.body,
    coverAssetId: cover,
    seoTitle: p.title,
    seoDescription: p.excerpt,
    status: 'published',
    authorName: 'Yayatoh team',
  });
  await platform(`create post ${p.slug}`, (tx) =>
    tx.execute(sql`select cms.platform_save_post(${payload}::jsonb, ${ACTOR})`),
  );
  log(`platform post ${p.slug}: created (${i + 1}/${POSTS.length})`);
}

for (const [i, [quote, name, role, rating, color]] of QUOTES.entries()) {
  const [exists] = await platform(
    `look for testimonial ${name}`,
    (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from cms.platform_testimonials where name = ${name} and quote = ${quote}`,
      ),
    false,
  );
  if (Number(exists?.n) > 0) {
    log(`testimonial ${name}: kept`);
    continue;
  }
  const photo = await asset(`person-${name}`, [color, '#ffffff', color], 240, 240);
  const payload = JSON.stringify({
    quote,
    name,
    role,
    photoAssetId: photo,
    rating,
    position: i,
    published: true,
  });
  await platform(`create testimonial ${name}`, (tx) =>
    tx.execute(sql`select cms.platform_save_testimonial(${payload}::jsonb, ${ACTOR})`),
  );
  log(`testimonial ${name}: created`);
}

// ---- an organization's own blog posts (its owner writes them, publishing makes them public)
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
