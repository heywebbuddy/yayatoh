import { closePools, sql, withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { getAuth } from '../src/server/auth.ts';
import { type EventSpec, ensureSeries, ensureVenues, type Profile } from './demo/common.ts';
import { conference } from './demo/conference.ts';
import { agency, community, other } from './demo/general.ts';
import { type Demo, failures, log } from './demo/kit.ts';
import { orgExtras, orgFeatures, orgLibrary } from './demo/org.ts';
import { concert, gala } from './demo/seated.ts';
import { wedding } from './demo/wedding.ts';

/*
 * Demo data for client testing: two fully set-up events per event profile (one upcoming, one
 * past and completed) in an EXISTING organization, owned and run by its existing owner, with the
 * attendees and guests on aliases of one address the client chose. Every write goes through the
 * platform's own commands, and no email, text or reminder is sent (see demo/kit.ts).
 *
 *   DEMO_ORG_SLUG=webbuddy DEMO_OWNER_EMAIL=ratnesh@webbuddy.agency \
 *   DEMO_ATTENDEE_EMAIL=kartik@webbuddy.agency node --conditions=react-server scripts/demo-seed.ts
 *
 * Re-running skips every event whose slug exists (all demo slugs start with `demo-`).
 */
const slug = process.env.DEMO_ORG_SLUG;
const ownerEmail = process.env.DEMO_OWNER_EMAIL?.toLowerCase();
const attendee = process.env.DEMO_ATTENDEE_EMAIL?.toLowerCase();
if (!slug || !ownerEmail || !attendee?.includes('@'))
  throw new Error('Set DEMO_ORG_SLUG, DEMO_OWNER_EMAIL and DEMO_ATTENDEE_EMAIL');
const onlyList = (process.env.DEMO_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const only = onlyList.length ? onlyList : null;

const resolved = await resolveOrgSlug(slug);
if (!resolved) throw new Error(`No organization ${slug}`);
const user = await (await getAuth().$context).internalAdapter.findUserByEmail(ownerEmail);
if (!user) throw new Error(`No user ${ownerEmail}`);
const [org] = await withTenant(
  createCtx({ orgId: resolved.orgId, actor: { type: 'system', name: 'demo-seed' } }),
  (tx) =>
    tx.execute<{ id: string; timezone: string; currency: string; role: string | null }>(sql`
    select o.id, o.timezone, o.currency,
           (select m.role from tenancy.memberships m where m.org_id = o.id and m.user_id = ${user.user.id}) as role
      from tenancy.organizations o where o.id = ${resolved.orgId}`),
);
if (!org) throw new Error(`No organization ${slug}`);
if (org.role !== 'owner') throw new Error(`${ownerEmail} is not an owner of ${slug}`);
const [local, domain] = attendee.split('@') as [string, string];
const d: Demo = {
  orgId: org.id,
  ownerId: user.user.id,
  timezone: org.timezone,
  currency: org.currency,
  attendeeEmail: (tag, n) => `${local.split('+')[0]}+${tag}${n}@${domain}`,
};
log(`org ${slug} (${org.timezone}, ${org.currency}), owner ${ownerEmail}, attendees ${local}+…@${domain}`);

const venues = await ensureVenues(d);
const liveSeries = await ensureSeries(
  d,
  'WebBuddy Live',
  'Our concert series: intimate nights with the artists we love.',
);
const summitSeries = await ensureSeries(
  d,
  'WebBuddy Summits',
  'Two-day conferences on technology, design and the future of work.',
);
const communitySeries = await ensureSeries(
  d,
  'Coastal Community Days',
  'Free and low-cost community days on the Goa coast.',
);

const base = (s: Omit<EventSpec, 'slug' | 'name'> & { key: string; title: string }): EventSpec => {
  const { key, title, ...rest } = s;
  return { slug: `demo-${key}`, name: `Demo · ${title}`, ...rest };
};

const EVENTS: { profile: Profile; tag: string; spec: EventSpec; weekly?: boolean }[] = [
  {
    profile: 'wedding',
    tag: 'wed1',
    spec: base({
      key: 'wedding-ananya-rohan',
      title: "Ananya & Rohan's Wedding",
      tagline: 'Three days of colour by Lake Pichola.',
      profile: 'wedding',
      category: 'social_gatherings',
      visibility: 'private',
      venue: 'palace',
      date: '2026-12-12',
      start: '16:00',
      endDate: '2026-12-14',
      end: '23:30',
      brandColor: '#b5576b',
      tags: ['wedding', 'udaipur', 'destination'],
      about:
        'We met in college in Pune and, twelve years later, we are getting married by the lake where Rohan proposed. Join us for mehendi, a sangeet night, the ceremony and a reception under the lanterns.',
      faq: [
        {
          question: 'What should I wear?',
          answer:
            'Colourful festive wear for the mehendi and sangeet; traditional formal wear for the ceremony and reception.',
        },
        {
          question: 'Can I bring a plus-one?',
          answer: 'Your invitation shows who is included. Write to us if anything is unclear.',
        },
        {
          question: 'Is there parking?',
          answer: 'Valet parking is available at the palace gate for all events.',
        },
        {
          question: 'Are children welcome?',
          answer: 'Yes! There is a kids’ corner with sitters during the reception.',
        },
      ],
      schedule: [
        { time: '16:00', title: 'Mehendi on the garden terrace', detail: 'Day 1' },
        { time: '19:00', title: 'Sangeet night', detail: 'Day 2' },
        { time: '10:00', title: 'Wedding ceremony at the lakeside mandap', detail: 'Day 3' },
        { time: '19:00', title: 'Reception in the Durbar hall', detail: 'Day 3' },
      ],
      announcement: {
        title: 'Shuttle times are up',
        body: 'Shuttles leave the city hotels every 30 minutes from 3 pm on each day. See the travel section on our website.',
      },
      privateInfo:
        'Your guest-site password is printed on your invitation card. Hotel pickup: call the concierge desk on arrival.',
      vanity: 'ananya-rohan',
    }),
  },
  {
    profile: 'wedding',
    tag: 'wed2',
    spec: base({
      key: 'wedding-meera-daniel',
      title: "Meera & Daniel's Wedding",
      tagline: 'A garden wedding that brought two families together.',
      profile: 'wedding',
      category: 'social_gatherings',
      visibility: 'private',
      venue: 'palace',
      date: '2026-09-18',
      start: '16:00',
      endDate: '2026-09-20',
      end: '23:30',
      brandColor: '#6b8f71',
      tags: ['wedding', 'garden', 'fusion'],
      about:
        'Meera and Daniel celebrated over three days with a mehendi, a sangeet with both families performing, a ceremony at sunrise and a reception that ended on the dance floor.',
      faq: [
        {
          question: 'Where can I see the photos?',
          answer: 'In the gallery on the wedding website: add your own too!',
        },
        {
          question: 'Who do I thank for the shuttles?',
          answer: 'Daniel’s cousins ran every shuttle. Buy them a drink.',
        },
        {
          question: 'Was there a dress code?',
          answer: 'Festive colours for the mehendi and sangeet; formal for the ceremony.',
        },
      ],
      schedule: [
        { time: '16:00', title: 'Mehendi', detail: 'Day 1' },
        { time: '19:00', title: 'Sangeet', detail: 'Day 2' },
        { time: '10:00', title: 'Ceremony', detail: 'Day 3' },
        { time: '19:00', title: 'Reception', detail: 'Day 3' },
      ],
      announcement: {
        title: 'Thank you for celebrating with us',
        body: 'The photos are in the gallery. Thank you for making it so special.',
      },
      vanity: 'meera-daniel',
    }),
  },
  {
    profile: 'gala',
    tag: 'gala1',
    spec: base({
      key: 'gala-starlight-charity',
      title: 'Starlight Charity Gala 2026',
      tagline: 'An evening of music and giving for rural classrooms.',
      profile: 'gala',
      category: 'charity',
      venue: 'ballroom',
      date: '2026-11-28',
      start: '19:00',
      end: '23:45',
      brandColor: '#1f3a68',
      tags: ['gala', 'charity', 'black tie'],
      about:
        'Our annual black-tie gala raises funds to furnish classrooms in rural schools. Dinner, a live string quartet, a fund-a-need paddle raise and dancing until midnight.',
      faq: [
        { question: 'What is the dress code?', answer: 'Black tie.' },
        {
          question: 'Is my ticket tax-deductible?',
          answer: 'The part above the fair market value of the dinner is; your receipt shows the amount.',
        },
        {
          question: 'Can I buy a whole table?',
          answer: 'Yes, sponsor tables of ten are available: write to us.',
        },
      ],
      schedule: [
        { time: '19:00', title: 'Welcome reception' },
        { time: '20:00', title: 'Dinner is served' },
        { time: '21:15', title: 'Fund-a-need paddle raise' },
        { time: '22:00', title: 'Dancing' },
      ],
      links: [{ label: 'About the classrooms programme', url: 'https://example.com/classrooms' }],
      announcement: {
        title: 'Table plan is live',
        body: 'Find your table in the seat finder. Doors open at 7 pm sharp.',
      },
      vanity: 'starlight-gala',
    }),
  },
  {
    profile: 'gala',
    tag: 'gala2',
    spec: base({
      key: 'gala-founders-circle',
      title: "Founders' Circle Dinner",
      tagline: 'Our donors’ dinner: the year in review, and the year ahead.',
      profile: 'gala',
      category: 'charity',
      venue: 'ballroom',
      date: '2026-10-03',
      start: '19:00',
      end: '23:30',
      brandColor: '#4b1d3f',
      tags: ['gala', 'donors', 'dinner'],
      about:
        'An intimate dinner for the people who make our programmes possible, with stories from the schools and a paddle raise for next year’s libraries.',
      faq: [
        { question: 'How did we do?', answer: 'Together we raised enough for 14 classrooms. Thank you!' },
        {
          question: 'Can I still pledge?',
          answer: 'Yes, write to us and we will add your pledge to this year’s campaign.',
        },
      ],
      schedule: [
        { time: '19:00', title: 'Reception' },
        { time: '20:00', title: 'Dinner' },
        { time: '21:30', title: 'Paddle raise' },
      ],
      announcement: { title: 'Thank you', body: 'Your pledges will furnish 14 classrooms next year.' },
    }),
  },
  {
    profile: 'concert',
    tag: 'live1',
    spec: base({
      key: 'concert-sunset-sessions',
      title: 'Sunset Sessions Live',
      tagline: 'Indie, folk and fusion under the open sky.',
      profile: 'concert',
      category: 'music',
      venue: 'arena',
      date: '2026-12-19',
      start: '18:30',
      end: '22:30',
      brandColor: '#db2777',
      tags: ['live music', 'indie', 'open air'],
      about:
        'Four bands, one stage and the best sunset in Bengaluru. Reserved seating in the Gold and Silver zones, or stand by the bar.',
      faq: [
        {
          question: 'Can I choose my seat?',
          answer: 'Yes: pick your seat on the map at checkout (Gold and Silver zones).',
        },
        { question: 'Is there food?', answer: 'Food trucks and a bar open from 5:30 pm.' },
        {
          question: 'Is the venue accessible?',
          answer: 'Wheelchair spaces are in rows A and B with step-free access at Gate 2.',
        },
      ],
      schedule: [
        { time: '17:30', title: 'Gates open' },
        { time: '18:30', title: 'Opening act: The Monsoon Club' },
        { time: '19:45', title: 'Raga Fusion Collective' },
        { time: '21:00', title: 'Headliner: Neon Banyan' },
      ],
      links: [{ label: 'Playlist', url: 'https://example.com/playlist' }],
      announcement: {
        title: 'Second headliner announced',
        body: 'Raga Fusion Collective joins the line-up!',
      },
      seriesId: liveSeries,
      vanity: 'sunset-live',
    }),
  },
  {
    profile: 'concert',
    tag: 'live2',
    spec: base({
      key: 'concert-monsoon-jazz',
      title: 'Monsoon Jazz Night',
      tagline: 'A night of jazz standards and new compositions.',
      profile: 'concert',
      category: 'music',
      venue: 'arena',
      date: '2026-09-26',
      start: '19:00',
      end: '22:30',
      brandColor: '#5b21b6',
      tags: ['jazz', 'live music'],
      about:
        'The Bengaluru Jazz Quartet with guest vocalist Leila Haddad: standards in the first set, new compositions in the second.',
      faq: [
        { question: 'Was it recorded?', answer: 'Yes, the recording will be on our website soon.' },
        { question: 'When is the next one?', answer: 'Follow the WebBuddy Live series for the next dates.' },
      ],
      schedule: [
        { time: '19:00', title: 'Doors' },
        { time: '19:30', title: 'First set' },
        { time: '21:00', title: 'Second set' },
      ],
      announcement: { title: 'Thank you, Bengaluru!', body: 'What a night. The recording is coming soon.' },
      seriesId: liveSeries,
    }),
  },
  {
    profile: 'conference',
    tag: 'fow',
    spec: base({
      key: 'conference-future-of-work',
      title: 'Future of Work Summit 2027',
      tagline: 'Two days on AI, teams and the way we build.',
      profile: 'conference',
      category: 'technology',
      venue: 'convention',
      date: '2027-01-21',
      start: '09:00',
      endDate: '2027-01-22',
      end: '18:00',
      brandColor: '#1d70a2',
      tags: ['conference', 'ai', 'leadership'],
      about:
        'Fourteen sessions across three tracks, hands-on workshops, an expo floor and 1:1 meetings with speakers and peers. Join in Hyderabad or watch online.',
      faq: [
        {
          question: 'Can I attend online?',
          answer: 'Yes, the virtual pass streams the keynotes and main-hall sessions live.',
        },
        {
          question: 'Do workshops cost extra?',
          answer: 'No, but places are limited: add them to your agenda.',
        },
        { question: 'Is there a student discount?', answer: 'Student passes are free with a valid ID.' },
      ],
      schedule: [
        { time: '08:30', title: 'Registration and coffee' },
        { time: '09:30', title: 'Opening keynote' },
        { time: '13:00', title: 'Lunch and networking' },
        { time: '17:30', title: 'Closing drinks' },
      ],
      links: [{ label: 'Venue map', url: 'https://example.com/venue-map' }],
      announcement: {
        title: 'Agenda published',
        body: 'The full two-day agenda is live. Build your schedule and book meetings.',
      },
      seriesId: summitSeries,
      vanity: 'fow-summit',
    }),
  },
  {
    profile: 'conference',
    tag: 'dev',
    spec: base({
      key: 'conference-devcon-india',
      title: 'DevCon India 2026',
      tagline: 'The builders’ conference: two days of code and craft.',
      profile: 'conference',
      category: 'technology',
      venue: 'convention',
      date: '2026-09-10',
      start: '09:00',
      endDate: '2026-09-11',
      end: '18:00',
      brandColor: '#0b2545',
      tags: ['developers', 'conference'],
      about:
        'Talks and workshops from engineers shipping at scale, an expo floor and a hallway track that went on late into the night.',
      faq: [
        {
          question: 'Where are the recordings?',
          answer: 'Recordings are available to pass holders on their ticket page.',
        },
        {
          question: 'How do I get my CPD certificate?',
          answer: 'Certificates are calculated from your session attendance.',
        },
      ],
      schedule: [
        { time: '09:00', title: 'Doors open' },
        { time: '09:30', title: 'Keynote' },
        { time: '17:30', title: 'Closing' },
      ],
      announcement: {
        title: 'See you next year',
        body: 'Thank you for joining DevCon India 2026. Slides are on the agenda pages.',
      },
      seriesId: summitSeries,
    }),
  },
  {
    profile: 'community',
    tag: 'beach',
    spec: base({
      key: 'community-beach-cleanup',
      title: 'Beach Clean-up & Picnic',
      tagline: 'Clean the coast in the morning, picnic together at noon.',
      profile: 'community',
      category: 'community',
      venue: 'hall',
      date: '2026-11-15',
      start: '07:00',
      end: '12:30',
      brandColor: '#2d6a4f',
      tags: ['volunteering', 'environment', 'family'],
      about:
        'Join neighbours, schools and local businesses for a morning on Miramar beach. We provide gloves, bags and breakfast; bring a hat and a friend.',
      faq: [
        { question: 'Is it free?', answer: 'Yes. Supporter tickets help us buy supplies.' },
        {
          question: 'Can children come?',
          answer: 'Absolutely: there is a kids’ team with its own activities.',
        },
      ],
      schedule: [
        { time: '07:00', title: 'Meet at the community hall' },
        { time: '07:30', title: 'Clean-up on Miramar beach' },
        { time: '11:00', title: 'Picnic and prizes' },
      ],
      announcement: {
        title: 'Bring a water bottle',
        body: 'We are going plastic-free this year: refill stations at the hall.',
      },
      seriesId: communitySeries,
      vanity: 'beach-day',
    }),
  },
  {
    profile: 'community',
    tag: 'food',
    spec: base({
      key: 'community-goa-food-festival',
      title: 'Goa Food Festival',
      tagline: 'Home cooks, local farmers and live music.',
      profile: 'community',
      category: 'food_drink',
      venue: 'hall',
      date: '2026-10-11',
      start: '11:00',
      end: '20:00',
      brandColor: '#f4a261',
      tags: ['food', 'festival', 'local'],
      about:
        'Thirty stalls of home cooking, a farmers’ market and a stage for local bands. Proceeds support the community kitchen.',
      faq: [
        { question: 'Was there vegetarian food?', answer: 'Half of the stalls were fully vegetarian.' },
        { question: 'Will it be back?', answer: 'Yes, next October!' },
      ],
      schedule: [
        { time: '11:00', title: 'Stalls open' },
        { time: '16:00', title: 'Cooking contest' },
        { time: '18:00', title: 'Live music' },
      ],
      announcement: { title: 'Thank you!', body: 'We served 2,000 plates. See you next year.' },
      seriesId: communitySeries,
    }),
  },
  {
    profile: 'agency',
    tag: 'nimbus',
    spec: base({
      key: 'agency-nimbus-launch',
      title: 'Nimbus Phone Launch (client event)',
      tagline: 'Press and partner launch event for our client Nimbus Technologies.',
      profile: 'agency',
      category: 'business_seminars',
      visibility: 'unlisted',
      venue: 'studio',
      date: '2026-12-03',
      start: '18:00',
      end: '21:30',
      brandColor: '#10b981',
      tags: ['launch', 'press', 'client'],
      about:
        'The launch of the Nimbus One phone for press, partners and invited guests, produced by WebBuddy for Nimbus Technologies.',
      faq: [
        {
          question: 'Can I bring a colleague?',
          answer: 'Invitations are personal. Ask your Nimbus contact for an extra pass.',
        },
        {
          question: 'Is there a live stream?',
          answer: 'Yes, the keynote is streamed on the Nimbus website.',
        },
      ],
      schedule: [
        { time: '18:00', title: 'Arrivals and hands-on area' },
        { time: '19:00', title: 'Keynote' },
        { time: '20:00', title: 'Press Q&A and reception' },
      ],
      announcement: { title: 'Embargo reminder', body: 'Press embargo lifts at 19:30 IST on the day.' },
      privateInfo: 'Press check-in is at the side entrance. Wi-Fi: NimbusLaunch / launch2026.',
    }),
  },
  {
    profile: 'agency',
    tag: 'partner',
    spec: base({
      key: 'agency-partner-meet',
      title: 'Annual Partner Meet 2026 (client event)',
      tagline: 'A day with Contoso’s partners: roadmap, awards and dinner.',
      profile: 'agency',
      category: 'business_seminars',
      visibility: 'unlisted',
      venue: 'studio',
      date: '2026-08-27',
      start: '10:00',
      end: '19:00',
      brandColor: '#374151',
      tags: ['partners', 'corporate', 'client'],
      about:
        'Contoso’s partner day, produced by WebBuddy: product roadmap, partner awards and a dinner on the terrace.',
      faq: [
        { question: 'Where are the slides?', answer: 'Your Contoso partner manager has sent them by email.' },
      ],
      schedule: [
        { time: '10:00', title: 'Welcome' },
        { time: '11:00', title: 'Roadmap' },
        { time: '16:00', title: 'Partner awards' },
      ],
      announcement: {
        title: 'Thank you, partners',
        body: 'Congratulations to all this year’s award winners.',
      },
    }),
  },
  {
    profile: 'other',
    tag: 'pottery',
    weekly: true,
    spec: base({
      key: 'other-pottery-workshop',
      title: 'Weekend Pottery Workshop',
      tagline: 'Six Saturdays at the wheel: beginners welcome.',
      profile: 'other',
      category: 'arts_culture',
      venue: 'studio',
      date: '2026-11-07',
      start: '10:00',
      end: '13:00',
      brandColor: '#e07a5f',
      tags: ['workshop', 'pottery', 'weekend'],
      about:
        'Pick any Saturday: learn to centre, throw and glaze with our studio potters. Small groups of 12, all materials included.',
      faq: [
        { question: 'Do I need experience?', answer: 'No, every session starts with the basics.' },
        { question: 'Can I take my pieces home?', answer: 'Yes, after firing (about two weeks later).' },
      ],
      schedule: [
        { time: '10:00', title: 'Wedging and centring' },
        { time: '11:00', title: 'Throwing' },
        { time: '12:30', title: 'Glazing demo' },
      ],
      announcement: { title: 'New dates added', body: 'Six Saturdays are now open for booking.' },
    }),
  },
  {
    profile: 'other',
    tag: 'photo',
    spec: base({
      key: 'other-heritage-photo-walk',
      title: 'Old Delhi Heritage Photo Walk',
      tagline: 'A sunrise walk through Chandni Chowk with a photographer.',
      profile: 'other',
      category: 'travel_leisure',
      venue: 'studio',
      date: '2026-10-04',
      start: '06:30',
      end: '09:30',
      brandColor: '#3d405b',
      tags: ['photography', 'heritage', 'walk'],
      about:
        'Three hours with a street photographer through the lanes of Old Delhi, ending with breakfast and a photo review.',
      faq: [{ question: 'Which camera should I bring?', answer: 'Any camera or a phone is fine.' }],
      schedule: [
        { time: '06:30', title: 'Meet at the studio' },
        { time: '07:00', title: 'Walk through Chandni Chowk' },
        { time: '09:00', title: 'Breakfast and photo review' },
      ],
      announcement: { title: 'Photos shared', body: 'The group’s best shots are in the event gallery.' },
    }),
  },
];

for (const e of EVENTS) {
  if (only && !only.some((o) => e.spec.slug.includes(o))) continue;
  const venuesById = venues;
  switch (e.profile) {
    case 'wedding':
      await wedding(d, venuesById, e.spec, e.tag);
      break;
    case 'gala':
      await gala(d, venuesById, e.spec, e.tag);
      break;
    case 'concert':
      await concert(d, venuesById, e.spec, e.tag);
      break;
    case 'conference':
      await conference(d, venuesById, e.spec, e.tag);
      break;
    case 'community':
      await community(d, venuesById, e.spec, e.tag);
      break;
    case 'agency':
      await agency(d, venuesById, e.spec, e.tag);
      break;
    case 'other':
      await other(d, venuesById, e.spec, e.tag, e.weekly === true);
      break;
  }
}
if (!only) {
  await orgFeatures(d);
  await orgExtras(d);
  await orgLibrary(d);
}

log(
  failures.length
    ? `done with ${failures.length} failed step(s):\n  ${failures.join('\n  ')}`
    : 'done, every step succeeded',
);
await closePools();
