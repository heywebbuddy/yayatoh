import {
  createEntryCommand,
  createSiteSectionCommand,
  setEntryStatusCommand,
  setSiteSectionStatusCommand,
} from '@yayatoh/cms';
import { sql } from '@yayatoh/db';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { getAuth } from '../src/server/auth.ts';
import { type Demo, log, owner, quietPorts, read, run, step } from './demo/kit.ts';

/*
 * Marketing content for the marketplace's own home page: a few published blog posts and organizer
 * testimonials on the content org (default `harbor-arts`, the org the marketplace shows content
 * from outside production). Safe to re-run: titles and headings that exist are skipped.
 *   DEMO_ORG_SLUG=harbor-arts DEMO_OWNER_EMAIL=lee@harbor.test node --conditions=react-server scripts/demo-marketing.ts
 */
void quietPorts;
const slug = process.env.DEMO_ORG_SLUG ?? 'harbor-arts';
const ownerEmail = (process.env.DEMO_OWNER_EMAIL ?? 'lee@harbor.test').toLowerCase();
const resolved = await resolveOrgSlug(slug);
const user = await (await getAuth().$context).internalAdapter.findUserByEmail(ownerEmail);
if (!resolved || !user) throw new Error('Unknown org or owner');
const d: Demo = {
  orgId: resolved.orgId,
  ownerId: user.user.id,
  timezone: 'UTC',
  currency: 'USD',
  attendeeEmail: () => '',
};
const ctx = () => owner(d);

const POSTS = [
  {
    title: 'How to price tickets without scaring buyers away',
    excerpt: 'Early-bird tiers, honest fees and why the full price should be on the first screen.',
    body: 'Buyers leave when the total jumps at checkout. Show the full price, fees included, from the first screen, then use two or three tiers to reward people who decide early.\n\n## Keep tiers simple\n\nEarly bird, standard and late are enough. Close each tier by date or by count, never both.\n\n## Free is a price too\n\nFree events still need a ticket: it gives you a head count, a way to message guests and a QR code at the door.',
  },
  {
    title: 'A calm door: five habits for faster check-in',
    excerpt: 'Scanner placement, a help queue and what to do when the connection drops.',
    body: 'Most queues form for the same reasons: one scanner, no help line and guests who cannot find their ticket.\n\n## Use two lanes\n\nOne for guests with a code, one for everyone else. The help queue keeps the first lane moving.\n\n## Plan for a weak connection\n\nThe scanner app keeps working offline and syncs when the signal returns.',
  },
  {
    title: 'Planning a wedding weekend: from guest list to thank-you notes',
    excerpt: 'RSVPs, seating, rooms and a day-of schedule your guests can find in one place.',
    body: 'A wedding is several events in a trench coat: a welcome dinner, the ceremony, the reception and brunch.\n\n## One guest list, many events\n\nInvite guests to the parts they are coming to and collect meal choices once.\n\n## Seating that follows the plan\n\nTables and a seat map keep the family politics out of the dance floor.',
  },
  {
    title: 'What a good conference agenda looks like',
    excerpt: 'Tracks, breaks and the one session type attendees always rate highest.',
    body: 'Plan breaks first. People remember the hallway conversations more than the third keynote.\n\n## Name your tracks plainly\n\n"Build", "Run" and "Grow" beat clever names.\n\n## Leave room for networking\n\nA directory with meeting requests turns a crowd into a community.',
  },
];

const QUOTES = [
  {
    heading: 'Priya Nair',
    eyebrow: 'Director, Lakeside Festivals',
    body: 'We moved our whole season to Yayatoh. Guests see one honest price and the door team stopped dreading Saturday.',
  },
  {
    heading: 'Marcus Webb',
    eyebrow: 'Founder, Harbor Arts',
    body: 'Setting up a concert took one evening. The seat map and the check-in app did the rest.',
  },
  {
    heading: 'Sofia Alvarez',
    eyebrow: 'Wedding planner, Casa Sofia',
    body: 'One guest list across the welcome dinner, ceremony and brunch. Families love the single link.',
  },
  {
    heading: 'Daniel Okoye',
    eyebrow: 'Programme lead, Lagos Tech Week',
    body: 'Sponsors get their leads the same day, and attendees actually use the networking tab.',
  },
];

const existing = await read<{ title: string }>(
  d,
  sql`select title from cms.entries where org_id = ${d.orgId}`,
);
for (const p of POSTS) {
  if (existing.some((e) => e.title === p.title)) continue;
  await step(`post ${p.title}`, async () => {
    const post = await run<unknown, { id: string }>(
      createEntryCommand,
      { kind: 'post', ...p, authorName: 'Yayatoh Team' },
      ctx(),
    );
    await run(setEntryStatusCommand, { entryId: post.id, action: 'publish' }, ctx());
  });
}
const have = await read<{ heading: string }>(
  d,
  sql`select heading from cms.site_sections where org_id = ${d.orgId} and placement = 'testimonials'`,
);
for (const [i, q] of QUOTES.entries()) {
  if (have.some((h) => h.heading === q.heading)) continue;
  await step(`quote ${q.heading}`, async () => {
    const s = await run<unknown, { id: string }>(
      createSiteSectionCommand,
      { placement: 'testimonials', locale: 'en', position: i, ...q },
      ctx(),
    );
    await run(setSiteSectionStatusCommand, { sectionId: s.id, action: 'publish' }, ctx());
  });
}
log('marketing content ready');
process.exit(0);
