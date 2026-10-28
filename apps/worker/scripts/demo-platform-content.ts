// Demo platform content: pnpm --filter @yayatoh/worker demo-platform-content
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { sql } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';

/*
 * Demo content for the platform blog and testimonials, written the way the admin console does it:
 * the cms.platform_* functions through platform_reader, as the actor `staff:demo-seed`, every call
 * in platform.access_log. 6 published blog posts with real cover images, a category, tags, an
 * author and a rich body (headings, lists, a quote, an image), and 6 testimonials with generated
 * photos and ratings.
 *
 * Idempotent, keyed by slug: a missing post is created; an existing one that has no category yet
 * (the posts already on a live database) gets its cover, category, tags, author and the rich body
 * (a body shorter than 700 characters is the old short demo text); one that already has a category
 * is kept. A testimonial is skipped when the same name and quote exist. Output: "created" /
 * "updated" / "kept" per item.
 *
 * Local:  DEMO_IMAGES_DIR=<demo images folder, e.g. D:/yayatoh_2.0/demo-images/web> \
 *         node --env-file=.env.local scripts/demo-platform-content.ts   (from apps/worker)
 * Live:   run the same command from a checkout of the deployed commit with the Railway variables
 *         of the live service set (DATABASE_URL / PLATFORM_READER_DATABASE_URL); migration 0192 must
 *         be applied. Do it on purpose: it writes to whatever database those variables name.
 * The organization's own demo posts are `apps/web/scripts/demo-content.ts`.
 */
setPlatformAuditSink(databaseAuditSink);
const ACTOR = 'staff:demo-seed';
const platform = <T>(reason: string, fn: Parameters<typeof withPlatformReader<T>>[1], write = true) =>
  withPlatformReader({ actor: ACTOR, reason: `demo content: ${reason}` }, fn, {
    callsWritingFunctions: write,
  });

/* A small PNG (diagonal gradient between two colours), without any image library. */
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = (crcTable[(c ^ x) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
function gradientPng(w: number, h: number, from: string, to: string): Buffer {
  const a = rgb(from);
  const b = rgb(to);
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      for (let c = 0; c < 3; c++)
        row[1 + x * 3 + c] = Math.round((a[c] as number) + ((b[c] as number) - (a[c] as number)) * t);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function asset(label: string, w: number, h: number, from: string, to: string): Promise<string> {
  const bytes = gradientPng(w, h, from, to);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const [row] = await platform(`store image ${label}`, (tx) =>
    tx.execute<{ id: string }>(
      sql`select cms.platform_store_asset('image', 'image/png', ${bytes}::bytea, ${sha}, ${ACTOR}) as id`,
    ),
  );
  return String(row?.id);
}

const imagesDir = process.env.DEMO_IMAGES_DIR;
if (!imagesDir) throw new Error('Set DEMO_IMAGES_DIR to the folder with the demo images');

/** Store a real JPEG from the demo images folder as a platform asset. */
async function photo(label: string, file: string): Promise<string> {
  const bytes = new Uint8Array(readFileSync(join(imagesDir as string, file)));
  const sha = createHash('sha256').update(bytes).digest('hex');
  const [row] = await platform(`store image ${label}`, (tx) =>
    tx.execute<{ id: string }>(
      sql`select cms.platform_store_asset('image', 'image/jpeg', ${Buffer.from(bytes)}::bytea, ${sha}, ${ACTOR}) as id`,
    ),
  );
  return String(row?.id);
}

interface PostSeed {
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly cover: string;
  readonly coverAlt: string;
  readonly inline: string;
  /** Days before now it was "published", so the blog has a real timeline. */
  readonly daysAgo: number;
  readonly body: (inlineUrl: string) => string;
}

const POSTS: readonly PostSeed[] = [
  {
    slug: 'welcome-to-yayatoh',
    title: 'Welcome to Yayatoh',
    excerpt: 'Ticketing, check-in and community tools for events of every size, in one place.',
    category: 'Product',
    tags: ['ticketing', 'getting started'],
    cover: 'live1-cover-1.jpg',
    coverAlt: 'A cheering crowd under stage lights at a live concert',
    inline: 'live1-gallery-2.jpg',
    daysAgo: 40,
    body: (u) =>
      `## One home for your events\n\nYayatoh helps organizers **sell tickets**, welcome guests and keep their community together, from the first announcement to the last check-in.\n\n- Beautiful event pages in your own colors\n- Whole tables, seats per date and live seating plans\n- Fast, reliable check-in with re-entry\n- Sponsors, speakers and exhibitors in one place\n\n![An event page on Yayatoh with tickets, agenda and speakers](${u})\n\n## Built for real events\n\nWe started with weddings, galas, concerts and conferences because they are hard: guest lists change, seats move and the door line never waits.\n\n> A good tool disappears at the door and shows up in the numbers afterwards.\n\n## Start small\n\nStart with a free event, learn the tools, and grow from there. Apply on the For organizers page and we will help you set up.`,
  },
  {
    slug: 'how-to-run-a-smooth-check-in',
    title: 'How to run a smooth check-in',
    excerpt: 'Five habits that keep the door line short, from badges to scanner placement.',
    category: 'Guides',
    tags: ['check-in', 'operations', 'badges'],
    cover: 'dev-cover-1.jpg',
    coverAlt: 'Attendees queueing with badges at a conference entrance',
    inline: 'dev-gallery-1.jpg',
    daysAgo: 28,
    body: (u) =>
      `## Before doors open\n\n1. Send each guest their ticket the day before.\n2. Print badges for sponsors and speakers in advance.\n3. Test every scanner on the venue Wi-Fi.\n\n![A staffed check-in desk with two scanners and printed badges](${u})\n\n## At the door\n\nSplit the line by ticket type and keep one **help desk** for lost tickets and name searches.\n\n## Re-entry without stress\n\nDecide the rule before the day: guests may leave and come back with a scan out and a scan in, and every scan is recorded.\n\n> The shortest line is the one nobody notices.\n\n## After the event\n\nExport attendance and send a thank-you the same evening. People remember how quickly you got them in, and how kindly you said goodbye.`,
  },
  {
    slug: 'selling-out-your-first-event',
    title: 'Selling out your first event',
    excerpt: 'Pricing, early-bird tickets and a launch plan that works for small teams.',
    category: 'Growth',
    tags: ['pricing', 'launch', 'marketing'],
    cover: 'gala1-cover-1.jpg',
    coverAlt: 'A full ballroom at a charity gala with guests at round tables',
    inline: 'gala1-gallery-1.jpg',
    daysAgo: 21,
    body: (u) =>
      `## Price with intent\n\nOffer an *early-bird* tier for the first 20% of tickets, then raise the price in steps. Each step is a reason to buy today.\n\n![Guests arriving at a sold-out gala](${u})\n\n## Tell people why\n\nA clear lineup, a real venue and a face behind the event build trust faster than discounts.\n\n## A launch plan for small teams\n\n1. Six weeks out: announce to your own list\n2. Four weeks out: early-bird closes, first reminder\n3. Two weeks out: share a behind-the-scenes post\n4. One week out: last-chance message by WhatsApp\n\n> Sold out is a feeling you create two weeks before it is true.\n\n## Keep a waitlist\n\nWhen the last ticket goes, open a waitlist. It tells you how big next year can be.`,
  },
  {
    slug: 'sponsors-that-come-back',
    title: 'Sponsors that come back every year',
    excerpt: 'What sponsors actually want to see in a report, and how to deliver it.',
    category: 'Partners',
    tags: ['sponsors', 'exhibitors', 'reporting'],
    cover: 'fow-cover-1.jpg',
    coverAlt: 'Exhibitors and visitors around booths in a conference hall',
    inline: 'fow-gallery-1.jpg',
    daysAgo: 14,
    body: (u) =>
      `## Give them numbers\n\nSend leads, booth visits and attendance within a week. Sponsors decide next year's budget in the same month.\n\n![An exhibitor scanning a visitor badge to capture a lead](${u})\n\n## Give them stories\n\nA short **video** and two quotes from attendees do more than a long deck.\n\n## What a good report contains\n\n- Attendance and how it compares with last year\n- Booth scans and the best-performing hour\n- Three attendee quotes\n- One suggestion for next time\n\n> Sponsors do not renew for logos. They renew for leads and for how you made them feel.`,
  },
  {
    slug: 'hybrid-events-without-the-headaches',
    title: 'Hybrid events without the headaches',
    excerpt: 'Run an in-person day and an online audience from the same ticket list.',
    category: 'Guides',
    tags: ['hybrid', 'virtual', 'chat'],
    cover: 'nimbus-cover-1.jpg',
    coverAlt: 'A speaker on stage with a camera and a screen showing online attendees',
    inline: 'nimbus-gallery-1.jpg',
    daysAgo: 7,
    body: (u) =>
      `## One ticket list\n\nOnline guests get a join link instead of a seat. Everyone appears in the same attendee list, so reports and receipts stay simple.\n\n![A lobby chat where remote and on-site guests talk to each other](${u})\n\n## Keep chat open\n\nA lobby chat keeps remote and on-site guests talking to each other, with moderation tools for your team.\n\n## Three rules for hybrid\n\n1. Treat the online audience as guests, not as a camera feed\n2. Give remote people a way to ask questions first\n3. Test the connection with the venue before doors open\n\n> Hybrid works when the person at home gets the same welcome as the person at the door.`,
  },
  {
    slug: 'sell-a-seat-for-one-day',
    title: 'Sell a seat for one day of a multi-day event',
    excerpt: 'Seat-per-date ticketing lets guests pick the exact seat for the exact day.',
    category: 'Product',
    tags: ['seating', 'multi-day', 'ticketing'],
    cover: 'wed1-cover-1.jpg',
    coverAlt: 'A wedding venue set with rows of chairs facing a flower arch',
    inline: 'wed1-gallery-1.jpg',
    daysAgo: 2,
    body: (u) =>
      `## One venue, many days\n\nA three-day wedding, a touring show or a weekend festival: the same room, different guests each day. Seat-per-date ticketing gives every date its own seat map.\n\n![A seating plan where each date has its own seat map](${u})\n\n## How it works\n\n1. Draw the floor plan once\n2. Choose the dates it applies to\n3. Guests pick a seat for each date they attend\n\n## Tables and singles\n\nSell **whole tables** to groups or single seats to individuals, and see sales per date on one screen.\n\n> A seat is only free once. A date makes it free again.\n\n## Try it\n\nOpen the seating tab of any event and switch on seat per date.`,
  },
];

/** A body shorter than this is still the old short demo text, which the rich body replaces. */
const OLD_SHORT_BODY = 700;

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

for (const [i, p] of POSTS.entries()) {
  const [row] = await platform(
    `look for post ${p.slug}`,
    (tx) =>
      tx.execute<{ id: string; category: string | null; body: string; status: string; published_at: string | null }>(
        sql`select id, category, body, status, published_at from cms.platform_posts where slug = ${p.slug}`,
      ),
    false,
  );
  if (row?.category) {
    console.info(`demo: platform post ${p.slug}: kept`);
    continue;
  }
  const cover = await photo(`post-${p.slug}`, p.cover);
  const inline = await photo(`post-${p.slug}-inline`, p.inline);
  const publishedAt = new Date(Date.now() - p.daysAgo * 86_400_000).toISOString();
  const payload = JSON.stringify({
    ...(row ? { id: row.id } : {}),
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    // A post someone has edited keeps its body; the old short demo text gets the rich one.
    body: row && row.body.length >= OLD_SHORT_BODY ? row.body : p.body(`/api/platform-assets/${inline}`),
    coverAssetId: cover,
    coverAlt: p.coverAlt,
    category: p.category,
    tags: p.tags,
    seoTitle: p.title,
    seoDescription: p.excerpt,
    status: 'published',
    authorName: 'Yayatoh team',
    publishedAt,
  });
  await platform(`${row ? 'update' : 'create'} post ${p.slug}`, (tx) =>
    tx.execute(sql`select cms.platform_save_post(${payload}::jsonb, ${ACTOR})`),
  );
  console.info(`demo: platform post ${p.slug}: ${row ? 'updated' : 'created'} (${i + 1}/${POSTS.length})`);
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
    console.info(`demo: testimonial ${name}: kept`);
    continue;
  }
  const photo = await asset(`person-${name}`, 240, 240, color, '#ffffff');
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
  console.info(`demo: testimonial ${name}: created`);
}
console.info('demo: platform content done');
process.exit(0);
