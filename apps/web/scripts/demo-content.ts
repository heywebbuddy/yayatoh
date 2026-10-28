import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createEntryCommand,
  setEntryStatusCommand,
  updateEntryCommand,
  uploadEntryCoverCommand,
} from '@yayatoh/cms';
import { closePools, sql, withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { getAuth } from '../src/server/auth.ts';
import { log, owner, run } from './demo/kit.ts';

/*
 * Demo blog posts of one organization: 4 published posts written by its owner through the cms
 * commands, with a cover image, a category, tags, an author and a rich body (headings, lists, a
 * quote and an image). They show on its organizer page `/organizers/{slug}/blogs` and its tenant
 * site. The platform blog and testimonials (admin-panel content, written through platform_reader)
 * are seeded by `apps/worker/scripts/demo-platform-content.ts`.
 *
 * Idempotent, keyed by the post title: a missing post is created and published; an existing one
 * (for example the posts already on a live database) that has no category yet gets its cover,
 * category, tags, author and the rich body (a body still shorter than 700 characters is the old
 * short demo text); one that already has a category is kept as it is.
 *
 *   DEMO_ORG_SLUG=webbuddy DEMO_OWNER_EMAIL=ratnesh@webbuddy.agency \
 *   DEMO_IMAGES_DIR=<folder with the demo images, e.g. D:/yayatoh_2.0/demo-images/web> \
 *   node --conditions=react-server scripts/demo-content.ts
 *
 * Run it on the live database only on purpose: point DATABASE_URL at it (the Railway variable), run
 * the command above from a checkout of the deployed commit, and read the output ("created" /
 * "updated" / "kept").
 */
const slug = process.env.DEMO_ORG_SLUG;
const ownerEmail = process.env.DEMO_OWNER_EMAIL?.toLowerCase();
const images = process.env.DEMO_IMAGES_DIR;
if (!slug || !ownerEmail || !images) throw new Error('Set DEMO_ORG_SLUG, DEMO_OWNER_EMAIL and DEMO_IMAGES_DIR');

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

const cover = async (file: string): Promise<string> => {
  const bytes = new Uint8Array(readFileSync(join(images, file)));
  const out = await run<unknown, { id: string }>(uploadEntryCoverCommand, { bytes }, owner(d));
  return out.id;
};
const img = (id: string) => `/api/blog-cover/${d.orgId}/${id}`;

interface DemoPost {
  readonly title: string;
  readonly excerpt: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly author: string;
  readonly cover: string;
  readonly coverAlt: string;
  readonly inline: string;
  readonly inlineAlt: string;
  readonly body: (inline: string) => string;
}

const ORG_POSTS: readonly DemoPost[] = [
  {
    title: 'Behind the scenes of our summer line-up',
    excerpt: 'How we picked the artists, the venue and the date, and what we nearly got wrong.',
    category: 'Behind the scenes',
    tags: ['music', 'venues', 'planning'],
    author: 'Ratnesh Kumar',
    cover: 'live2-cover-1.jpg',
    coverAlt: 'A crowd with raised hands in front of a lit stage at dusk',
    inline: 'live1-gallery-1.jpg',
    inlineAlt: 'Soundcheck on the main stage an hour before doors',
    body: (i) =>
      `Every summer line-up starts the same way: a long list, a short budget and a month of listening before we book a single artist.\n\n## Picking the artists\n\nWe listen for a month. Then we ask three questions of every act:\n\n- Will our regulars cross town for them?\n- Do they work in a room of 600, not just a festival field?\n- Can the sound crew make them shine in two hours of soundcheck?\n\n> The best bill is the one where the first and last act could swap places and nobody would mind.\n\n## The venue\n\nWe chose a **waterfront hall** with room for 600 people, a real stage and a loading bay that does not block the street.\n\n![${'Soundcheck on the main stage an hour before doors'}](${img(i)})\n\n## The date\n\nWe avoided school exams, two cricket finals and one very large wedding. What was left was the second Saturday of June.\n\n## What we nearly got wrong\n\nWe forgot the second entrance. Queues were long until a volunteer moved a barrier, and now every plan has a door map on page one.`,
  },
  {
    title: 'What we learned running 30 events this year',
    excerpt: 'Three things that went wrong, what we changed and the checklist we use now.',
    category: 'Lessons',
    tags: ['operations', 'checklist', 'check-in'],
    author: 'WebBuddy team',
    cover: 'gala2-cover-1.jpg',
    coverAlt: 'Round gala tables set with candles and white flowers',
    inline: 'gala2-gallery-1.jpg',
    inlineAlt: 'A ballroom laid out the night before the event',
    body: (i) =>
      `Thirty events, six cities and one very patient crew. Here is what we would tell ourselves in January.\n\n## 1. Doors open too late\n\nWe now open **45 minutes** before the start, with the scanners tested on the venue network the day before.\n\n## 2. Not enough signs\n\nEvery corridor gets a sign, and every sign gets read by someone who has never been there.\n\n![${'A ballroom laid out the night before the event'}](${img(i)})\n\n## 3. Slow refunds\n\nWe moved refunds to the same day. Support tickets about refunds dropped by half.\n\n## The checklist we use now\n\n1. Door map on page one of the run sheet\n2. Scanners and printers tested on site\n3. One person who owns the guest list\n4. A named lead for every room\n\n> If something can go wrong at the door, it will go wrong at 6:58 pm.\n\nIf you take one thing from this post, take the checklist.`,
  },
  {
    title: 'Announcing our autumn community days',
    excerpt: 'Free and low-cost days on the coast, open to everyone, with food, music and workshops.',
    category: 'Announcements',
    tags: ['community', 'family', 'autumn'],
    author: 'WebBuddy team',
    cover: 'food-cover-1.jpg',
    coverAlt: 'Stalls with fresh food and a crowd walking between them',
    inline: 'food-gallery-1.jpg',
    inlineAlt: 'Local makers selling food at last year’s market',
    body: (i) =>
      `Join us for **three community days** this autumn: food, music and workshops for all ages, right on the coast.\n\n## What is on\n\n- Free entry for children under 12\n- A local makers market with 40 stalls\n- Hands-on workshops: pottery, printmaking and street food\n- An evening concert on the lawn\n\n![${'Local makers selling food at last year’s market'}](${img(i)})\n\n## Good to know\n\nTickets are low-cost and every ticket includes a food voucher. Wheelchair access, quiet hours and a family room are on every day.\n\n> Last year a stall holder told us it was the best three days of her business year. We want to repeat that.\n\nTickets go on sale on the first of the month.`,
  },
  {
    title: 'Behind the scenes: a palace wedding',
    excerpt: 'Four days, 300 guests and one very calm lake: how our crew pulled it off.',
    category: 'Weddings',
    tags: ['wedding', 'destination', 'logistics'],
    author: 'WebBuddy Events',
    cover: 'wed2-cover-1.jpg',
    coverAlt: 'A wedding ceremony by a lake at golden hour',
    inline: 'wed2-gallery-1.jpg',
    inlineAlt: 'The mehendi evening in the palace courtyard',
    body: (i) =>
      `From the mehendi to the reception, here is how our crew pulled off a four-day celebration by the lake.\n\n## Day one: the arrivals\n\nThree hundred guests, five airports and two shuttles that had to be everywhere at once. We built the guest site first so everyone saw their own schedule and their own seat.\n\n![${'The mehendi evening in the palace courtyard'}](${img(i)})\n\n## What made it calm\n\n1. A **single guest list** with meal choices and transport\n2. A seating plan the couple could change until the last morning\n3. A producer for every day, not just for the ceremony\n\n> The calmest wedding is the one where the plan is boring and the guests never see it.\n\n## Monsoon plan\n\nWe had a second ceremony space under cover and a message to every guest in their own language, ready to send in one click. We never needed it, which is exactly the point.`,
  },
];

for (const p of ORG_POSTS) {
  const ctx = createCtx({ orgId: d.orgId, actor: { type: 'system', name: 'demo-content' } });
  const [row] = await withTenant(ctx, (tx) =>
    tx.execute<{ id: string; category: string | null; body: string; status: string }>(
      sql`select id, category, body, status from cms.entries where kind = 'post' and title = ${p.title} limit 1`,
    ),
  );
  if (row?.category) {
    log(`org post "${p.title}": kept`);
    continue;
  }
  const coverId = await cover(p.cover);
  const inlineId = await cover(p.inline);
  const rich = {
    excerpt: p.excerpt,
    body: p.body(inlineId),
    category: p.category,
    tags: [...p.tags],
    authorName: p.author,
    coverAssetId: coverId,
    coverAlt: p.coverAlt,
  };
  if (!row) {
    const entry = await run<unknown, { id: string }>(
      createEntryCommand,
      { kind: 'post', title: p.title, ...rich },
      owner(d),
    );
    await run(setEntryStatusCommand, { entryId: entry.id, action: 'publish' }, owner(d));
    log(`org post "${p.title}": created and published`);
    continue;
  }
  // An existing post keeps a body someone has edited; the old short demo text is replaced.
  await run(
    updateEntryCommand,
    { entryId: row.id, ...rich, ...(row.body.length >= 700 ? { body: undefined } : {}) },
    owner(d),
  );
  if (row.status !== 'published') await run(setEntryStatusCommand, { entryId: row.id, action: 'publish' }, owner(d));
  log(`org post "${p.title}": updated (cover, category, tags, author${row.body.length >= 700 ? '' : ', body'})`);
}

log('demo content: done');
await closePools();
