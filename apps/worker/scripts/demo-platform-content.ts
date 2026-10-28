// Demo platform content: pnpm --filter @yayatoh/worker demo-platform-content
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { sql } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';

/*
 * Demo content for the platform blog and testimonials, written the way the admin console does it:
 * the cms.platform_* functions through platform_reader, as the actor `staff:demo-seed`, every call
 * in platform.access_log. 5 published blog posts with generated cover images and 6 testimonials
 * with generated photos and ratings.
 *
 * Idempotent: a post is skipped when its slug exists, a testimonial when the same name and quote
 * exist; re-running adds nothing ("created" / "kept" per item).
 *
 * Local:  node --env-file=.env.local scripts/demo-platform-content.ts   (from apps/worker)
 * Live:   run the same command from a checkout of the deployed commit with the Railway variables
 *         of the live service set (DATABASE_URL / PLATFORM_READER_DATABASE_URL); migration 0190 must
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

const POSTS = [
  {
    slug: 'welcome-to-yayatoh',
    title: 'Welcome to Yayatoh',
    excerpt: 'Ticketing, check-in and community tools for events of every size, in one place.',
    colors: ['#5b21b6', '#db2777'],
    body: '## One home for your events\n\nYayatoh helps organizers **sell tickets**, welcome guests and keep their community together.\n\n- Beautiful event pages\n- Fast, reliable check-in\n- Sponsors, speakers and exhibitors in one place\n\nStart with a free event and grow from there.',
  },
  {
    slug: 'how-to-run-a-smooth-check-in',
    title: 'How to run a smooth check-in',
    excerpt: 'Five habits that keep the door line short, from badges to scanner placement.',
    colors: ['#0b2545', '#1d70a2'],
    body: '## Before doors open\n\n1. Send each guest their ticket the day before.\n2. Print badges for sponsors and speakers in advance.\n3. Test every scanner on the venue Wi-Fi.\n\n## At the door\n\nSplit the line by ticket type and keep one **help desk** for lost tickets.',
  },
  {
    slug: 'selling-out-your-first-event',
    title: 'Selling out your first event',
    excerpt: 'Pricing, early-bird tickets and a launch plan that works for small teams.',
    colors: ['#0f1b3d', '#c9a227'],
    body: '## Price with intent\n\nOffer an *early-bird* tier for the first 20% of tickets, then raise the price in steps.\n\n## Tell people why\n\nA clear lineup, a real venue and a face behind the event build trust faster than discounts.',
  },
  {
    slug: 'sponsors-that-come-back',
    title: 'Sponsors that come back every year',
    excerpt: 'What sponsors actually want to see in a report, and how to deliver it.',
    colors: ['#111827', '#10b981'],
    body: '## Give them numbers\n\nSend leads, booth visits and attendance within a week.\n\n## Give them stories\n\nA short **video** and two quotes from attendees do more than a long deck.',
  },
  {
    slug: 'hybrid-events-without-the-headaches',
    title: 'Hybrid events without the headaches',
    excerpt: 'Run an in-person day and an online audience from the same ticket list.',
    colors: ['#1b4332', '#f4a261'],
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
    console.info(`demo: platform post ${p.slug}: kept`);
    continue;
  }
  const cover = await asset(`post-${p.slug}`, 1280, 720, p.colors[0], p.colors[1]);
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
  console.info(`demo: platform post ${p.slug}: created (${i + 1}/${POSTS.length})`);
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
