import { listBrandKitsQuery, saveBrandKitCommand } from '@yayatoh/ai';
import { setSalesTargetCommand } from '@yayatoh/alerts';
import { saveSegmentCommand } from '@yayatoh/audiences';
import { createJourneyCommand } from '@yayatoh/automations';
import { createCampaignCommand, saveCampaignCommand, setAudienceCommand } from '@yayatoh/campaigns';
import { createEntryCommand, setEntryStatusCommand } from '@yayatoh/cms';
import { sql } from '@yayatoh/db';
import { updateSiteSettingsCommand } from '@yayatoh/marketplace';
import { buildRoundTable, buildRow } from '@yayatoh/floorplan';
import { setTemplateOverrideCommand } from '@yayatoh/notifications';
import { saveSupportMacroCommand, setRefundPolicyCommand } from '@yayatoh/orders';
import { saveLayoutCommand } from '@yayatoh/seating';
import { copyStarterCommand, saveTemplateCommand } from '@yayatoh/templates';
import { setLegalPageCommand, updateOrganizationCommand } from '@yayatoh/tenancy';
import { ask, type Demo, log, owner, read, run, step } from './kit.ts';

interface DemoEventRef {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly profile: string;
  readonly past: boolean;
}

/** The demo events of the org (by slug prefix), for org-level features that point at events. */
export async function demoEvents(d: Demo): Promise<DemoEventRef[]> {
  const rows = await read<
    { id: string; slug: string; name: string; profile: string; ends_at: Date } & Record<string, unknown>
  >(
    d,
    sql`select id, slug, name, profile, ends_at from events.events where slug like 'demo-%' order by starts_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    profile: r.profile,
    past: new Date(r.ends_at).getTime() < Date.now(),
  }));
}

/** Org-level marketing and site content tied to the demo events. Safe to re-run (checks by name). */
export async function orgFeatures(d: Demo) {
  const ctx = () => owner(d);
  const events = await demoEvents(d);
  const upcoming = events.filter((e) => !e.past);

  const kits = await ask<unknown, { name: string }[]>(listBrandKitsQuery, {}, ctx()).catch(() => []);
  if (!kits.some((k) => k.name === 'WebBuddy voice'))
    await step('brand kit', () =>
      run(
        saveBrandKitCommand,
        {
          name: 'WebBuddy voice',
          voice: 'Warm, confident and practical. Short sentences; we speak to guests like friends.',
          tone: 'friendly',
          keywords: ['unforgettable', 'together', 'curated'],
          avoid: ['cheap', 'synergy'],
          isDefault: true,
        },
        ctx(),
      ),
    );

  // Org site pages (published) and the site and marketplace settings.
  const pages = await read<{ title: string } & Record<string, unknown>>(
    d,
    sql`select title from cms.entries`,
  ).catch(() => []);
  const navIds: string[] = [];
  for (const [title, excerpt, body] of [
    [
      'About WebBuddy Events',
      'Weddings, galas, concerts and conferences, produced end to end.',
      '## Who we are\n\nWebBuddy Events plans and runs celebrations and conferences across India.\n\n- 120+ events a year\n- A crew of 40 producers\n- Venues from Udaipur to Hyderabad',
    ],
    [
      'Frequently asked questions',
      'Tickets, refunds, accessibility and getting to our venues.',
      '## Tickets\n\nTickets are emailed right after checkout.\n\n## Refunds\n\nFull refunds up to 7 days before the event.\n\n## Accessibility\n\nEvery venue lists its access details on the event page.',
    ],
    [
      'Plan your event with us',
      'Tell us about your wedding, gala or company event.',
      'Write to us with your date, city and guest count and a producer will call you within a day.',
    ],
  ] as const) {
    if (pages.some((p) => p.title === title)) continue;
    const entry = await step(`page ${title}`, () =>
      run<unknown, { id: string }>(createEntryCommand, { kind: 'page', title, excerpt, body }, ctx()),
    );
    if (!entry) continue;
    navIds.push(entry.id);
    await step(`publish ${title}`, () =>
      run(setEntryStatusCommand, { entryId: entry.id, action: 'publish' }, ctx()),
    );
  }
  await step('blog post', async () => {
    if (pages.some((p) => p.title === 'Behind the scenes: a palace wedding')) return;
    const post = await run<unknown, { id: string }>(
      createEntryCommand,
      {
        kind: 'post',
        title: 'Behind the scenes: a palace wedding',
        excerpt: 'Four days, 300 guests and one very calm lake.',
        body: 'From the mehendi to the reception, here is how our crew pulled off a four-day celebration by the lake.',
        authorName: 'WebBuddy Events',
      },
      ctx(),
    );
    await run(setEntryStatusCommand, { entryId: post.id, action: 'publish' }, ctx());
  });
  await step('site settings', () =>
    run(
      updateSiteSettingsCommand,
      { listOnMarketplace: true, tenantSite: true, ...(navIds.length ? { navPageIds: navIds } : {}) },
      ctx(),
    ),
  );

  // Audience segments.
  const segments = await read<{ id: string; name: string } & Record<string, unknown>>(
    d,
    sql`select id, name from audiences.segments`,
  ).catch(() => []);
  const segment = async (name: string, definition: unknown) => {
    const found = segments.find((s) => s.name === name);
    if (found) return found.id;
    const r = await step(`segment ${name}`, () =>
      run<unknown, { id: string }>(saveSegmentCommand, { segmentId: null, name, definition }, ctx()),
    );
    return r?.id ?? null;
  };
  const all = await segment('Everyone who came to a demo event', {
    version: 1,
    root: {
      type: 'group',
      op: 'and',
      conditions: [{ type: 'participation', scope: { kind: 'any' }, role: 'attendee', checkedIn: true }],
    },
  });
  await segment('Buyers with email consent', {
    version: 1,
    root: {
      type: 'group',
      op: 'and',
      conditions: [
        { type: 'participation', scope: { kind: 'any' }, role: 'buyer' },
        { type: 'consent', channel: 'email', granted: true },
      ],
    },
  });
  await segment('Repeat guests (2+ events)', {
    version: 1,
    root: {
      type: 'group',
      op: 'and',
      conditions: [{ type: 'totals', metric: 'events', op: 'gte', value: 2 }],
    },
  });

  // Draft campaigns for three upcoming events (never sent or scheduled by the seed).
  const campaigns = await read<{ name: string } & Record<string, unknown>>(
    d,
    sql`select name from campaigns.campaigns`,
  ).catch(() => []);
  for (const e of upcoming
    .filter((x) => ['concert', 'conference', 'community', 'gala'].includes(x.profile))
    .slice(0, 4)) {
    const name = `Announce: ${e.name.replace(/^Demo · /, '')}`;
    if (campaigns.some((c) => c.name === name)) continue;
    await step(`campaign ${name}`, async () => {
      const c = await run<unknown, { id: string }>(
        createCampaignCommand,
        { name, channel: 'email', locale: 'en' },
        ctx(),
      );
      await run(
        saveCampaignCommand,
        {
          campaignId: c.id,
          name,
          locale: 'en',
          content: {
            subject: `{{first_name}}, ${e.name.replace(/^Demo · /, '')} is coming up`,
            preheader: 'Tickets are going fast. Here is everything you need to know.',
            font: 'sans',
            smsBody: '',
            blocks: [
              { id: 'h1', type: 'heading', text: e.name.replace(/^Demo · /, '') },
              {
                id: 't1',
                type: 'text',
                text: 'Hi {{first_name}}, we would love to see you there. Early-bird prices end soon.',
              },
              { id: 'e1', type: 'eventCard', eventId: e.id },
              { id: 'b1', type: 'button', label: 'Get tickets', eventId: e.id },
              { id: 'd1', type: 'divider' },
              {
                id: 'f1',
                type: 'footer',
                postalAddress: 'WebBuddy Events, 22 Marine Drive, Mumbai 400020, India',
              },
            ],
          },
        },
        ctx(),
      );
      if (all)
        await run(
          setAudienceCommand,
          { campaignId: c.id, audience: { kind: 'segment', segmentId: all } },
          ctx(),
        );
    });
  }

  // A journey for the upcoming conference (created switched off: nothing is sent).
  const conf = upcoming.find((e) => e.profile === 'conference');
  if (conf)
    await step('journey', async () => {
      const exists = await read<{ n: number } & Record<string, unknown>>(
        d,
        sql`select count(*)::int as n from automations.journeys where name = 'Conference welcome series'`,
      ).catch(() => [{ n: 0 }]);
      if ((exists[0]?.n ?? 0) > 0) return;
      await run(
        createJourneyCommand,
        {
          name: 'Conference welcome series',
          eventId: conf.id,
          trigger: 'order_paid',
          steps: [
            {
              anchor: 'trigger',
              offsetDays: 0,
              offsetMinutes: 10,
              action: 'email',
              subject: 'Welcome to the summit, {{first_name}}',
              body: 'Here is how to plan your two days: build your agenda and book meetings.',
            },
            {
              anchor: 'event_start',
              offsetDays: -3,
              offsetMinutes: 0,
              atTime: '10:00',
              action: 'email',
              subject: 'Three days to go',
              body: 'Doors open at 8:30. Bring your QR ticket for a fast check-in.',
            },
            {
              anchor: 'event_end',
              offsetDays: 1,
              offsetMinutes: 0,
              atTime: '11:00',
              action: 'survey',
              subject: 'How was it?',
              body: 'Tell us in two minutes.',
            },
          ],
        },
        ctx(),
      );
    });

  // Sales targets for the upcoming ticketed events (the Command Center pace alerts use them).
  for (const e of upcoming.filter((x) => x.profile !== 'wedding'))
    await step(`sales target ${e.slug}`, () =>
      run(setSalesTargetCommand, { eventId: e.id, tickets: 150 }, ctx()),
    );
  log(`org features for ${events.length} demo events`);
}

const POSTS = [
  [
    'Five things we learned running a palace wedding',
    'Shuttles, monsoon plans and the magic of a good seating chart.',
    '## Plan the shuttles first\n\nGuests remember how they got there. We ran shuttles every 30 minutes from three hotels.\n\n## Always have a rain plan\n\nThe sangeet moved indoors in 40 minutes because the plan was ready.\n\n## Seat families together\n\nThe seating chart took two evenings and saved the reception.',
  ],
  [
    'How we raised funds for 14 classrooms in one night',
    'Inside our paddle raise: levels, matching gifts and timing.',
    'A fund-a-need works when guests can picture the gift. We set three levels, announced a matching sponsor and kept the call under fifteen minutes.\n\n- A classroom for a year\n- Library books\n- A school day',
  ],
  [
    'Conference checklist: 60 days to doors open',
    'Speakers, sponsors, badges and the hallway track.',
    '## 60 days\n\nConfirm speakers and publish the agenda.\n\n## 30 days\n\nSponsor deliverables in, badges designed.\n\n## 7 days\n\nPrint badges, brief the door team, test the live stream.',
  ],
] as const;

const LEGAL = {
  privacy:
    '**Sample privacy notice (demo data).** WebBuddy Events uses your name, email and ticket details to run the events you book, send your tickets and tell you about changes. We never sell your data. Write to us to see, correct or delete what we hold about you.',
  terms:
    '**Sample terms (demo data).** Tickets are personal and may be transferred where the event allows it. We may refuse entry for safety reasons. Event details can change; we tell ticket holders by email.',
  refund:
    '**Sample refund policy (demo data).** Full refunds up to 7 days before the event, unless the event page says otherwise. If we cancel an event, every ticket is refunded in full.',
} as const;

/** Org identity and content beyond the events: brand colour, legal pages, more kits and posts. */
export async function orgExtras(d: Demo) {
  const ctx = () => owner(d);
  const [org] = await read<{ brand_color: string | null } & Record<string, unknown>>(
    d,
    sql`select brand_color from tenancy.organizations where id = ${d.orgId}`,
  );
  if (!org?.brand_color)
    await step('org brand colour', () => run(updateOrganizationCommand, { brandColor: '#6d28d9' }, ctx()));
  const legal = await read<{ kind: string } & Record<string, unknown>>(d, sql`select kind from tenancy.legal_pages`).catch(
    () => [],
  );
  for (const [kind, body] of Object.entries(LEGAL))
    if (!legal.some((l) => l.kind === kind))
      await step(`legal page ${kind}`, () => run(setLegalPageCommand, { kind, body }, ctx()));
  const kits = await ask<unknown, { name: string }[]>(listBrandKitsQuery, {}, ctx()).catch(() => []);
  for (const kit of [
    {
      name: 'Wedding warmth',
      voice: 'Heartfelt and personal; we celebrate families and traditions.',
      tone: 'inspiring',
      keywords: ['celebration', 'family', 'blessings'],
      avoid: ['deal', 'cheap'],
    },
    {
      name: 'Corporate crisp',
      voice: 'Clear, confident and brief; every line earns its place.',
      tone: 'formal',
      keywords: ['insight', 'network', 'agenda'],
      avoid: ['awesome', 'crazy'],
    },
  ])
    if (!kits.some((k) => k.name === kit.name)) await step(`brand kit ${kit.name}`, () => run(saveBrandKitCommand, kit, ctx()));
  const entries = await read<{ title: string } & Record<string, unknown>>(d, sql`select title from cms.entries`).catch(() => []);
  for (const [title, excerpt, body] of POSTS) {
    if (entries.some((e) => e.title === title)) continue;
    await step(`post ${title}`, async () => {
      const post = await run<unknown, { id: string }>(
        createEntryCommand,
        { kind: 'post', title, excerpt, body, authorName: 'WebBuddy Events' },
        ctx(),
      );
      await run(setEntryStatusCommand, { entryId: post.id, action: 'publish' }, ctx());
    });
  }
  // Refund policies on the upcoming ticketed events (the checkout and order pages show them).
  for (const e of (await demoEvents(d)).filter((x) => !x.past && x.profile !== 'wedding'))
    await step(`refund policy ${e.slug}`, () =>
      run(setRefundPolicyCommand, { eventId: e.id, kind: 'until', daysBefore: 7, retainedMinor: 0 }, ctx()),
    );
  log('org extras');
}

/** Libraries the org keeps across events: templates, reusable seating plans, macros, email copy. */
export async function orgLibrary(d: Demo) {
  const ctx = () => owner(d);
  const events = await demoEvents(d);
  const templates = await read<{ name: string } & Record<string, unknown>>(d, sql`select name from templates.event_templates`).catch(
    () => [],
  );
  const fromEvent: [string, string, string][] = [
    ['demo-wedding-ananya-rohan', 'Destination wedding (3 days)', 'Mehendi, sangeet, ceremony and reception, with the guest website and seating chart.'],
    ['demo-conference-future-of-work', 'Two-day conference', 'Tracks, rooms, session types, sponsor tiers and badges, ready for a new edition.'],
    ['demo-concert-sunset-sessions', 'Seated concert', 'Gold and silver zones, standing room and a VIP lounge.'],
  ];
  for (const [slug, name, description] of fromEvent) {
    const ev = events.find((e) => e.slug === slug);
    if (ev && !templates.some((t) => t.name === name))
      await step(`template ${name}`, () => run(saveTemplateCommand, { eventId: ev.id, name, description }, ctx()));
  }
  if (!templates.some((t) => t.name === 'Charity gala starter'))
    await step('starter gala template', () =>
      run(copyStarterCommand, { starter: 'gala', name: 'Charity gala starter', timezone: d.timezone, currency: d.currency }, ctx()),
    );

  const layouts = await read<{ name: string } & Record<string, unknown>>(d, sql`select name from seating.layouts`).catch(() => []);
  const object = (objectType: string, label: string, x: number, y: number, width: number, height: number) => ({
    kind: 'object' as const,
    id: crypto.randomUUID(),
    objectType,
    label,
    x,
    y,
    width,
    height,
  });
  const plans: [string, unknown][] = [
    [
      'Banquet hall: 12 rounds of 10',
      {
        version: 1,
        width: 2000,
        height: 2000,
        items: [
          ...Array.from({ length: 12 }, (_, i) =>
            buildRoundTable({ label: `${i + 1}`, seats: 10, x: 300 + (i % 4) * 450, y: 600 + Math.floor(i / 4) * 450 }),
          ),
          object('stage', 'Stage', 800, 60, 400, 180),
          object('dance_floor', 'Dance floor', 850, 1800, 300, 150),
        ],
      },
    ],
    [
      'Theatre: 10 rows of 20',
      {
        version: 1,
        width: 1800,
        height: 1500,
        items: [
          ...Array.from({ length: 10 }, (_, i) => buildRow({ label: String.fromCharCode(65 + i), count: 20, x: 300, y: 400 + i * 90 })),
          object('stage', 'Stage', 500, 60, 800, 220),
        ],
      },
    ],
  ];
  for (const [name, doc] of plans)
    if (!layouts.some((l) => l.name === name)) await step(`seating plan ${name}`, () => run(saveLayoutCommand, { name, doc }, ctx()));

  const macros = await read<{ name: string } & Record<string, unknown>>(d, sql`select name from orders.support_macros`).catch(() => []);
  const MACROS = [
    {
      name: 'Resend tickets',
      subject: 'Your tickets for {{event_name}}',
      body: 'Hi {{buyer_name}},\n\nHere are your {{ticket_count}} ticket(s) for {{event_name}} on {{event_date}} again. Order {{order_ref}}.\n\nSee you there!',
      actions: ['resend_tickets', 'email_buyer'],
    },
    {
      name: 'Name change done',
      subject: 'Ticket updated for {{event_name}}',
      body: 'Hi {{buyer_name}}, the ticket on order {{order_ref}} is now in the name of {{recipient_name}}.',
      actions: ['transfer_ticket', 'email_buyer', 'add_note'],
    },
    {
      name: 'Accessibility request noted',
      subject: 'Your request for {{event_name}}',
      body: 'Hi {{buyer_name}}, thank you for letting us know. Our door team will meet you at the accessible entrance on {{event_date}}.',
      actions: ['email_buyer', 'add_note'],
    },
  ];
  for (const m of MACROS)
    if (!macros.some((x) => x.name === m.name)) await step(`macro ${m.name}`, () => run(saveSupportMacroCommand, m, ctx()));

  const overrides = await read<{ kind: string } & Record<string, unknown>>(d, sql`select kind from notifications.template_overrides`).catch(
    () => [],
  );
  const EMAILS = [
    { kind: 'orders.tickets', subject: 'Your WebBuddy Events tickets are here', intro: 'Thank you for booking with WebBuddy Events! Your tickets are below: show the QR code at the door.' },
    { kind: 'events.reminder', subject: 'See you tomorrow!', intro: 'Your event is tomorrow. Doors open 30 minutes before the start: bring your QR ticket for a fast check-in.' },
  ];
  for (const e of EMAILS)
    if (!overrides.some((o) => o.kind === e.kind))
      await step(`email copy ${e.kind}`, () => run(setTemplateOverrideCommand, { ...e, locale: 'en' }, ctx()));
  log('org library');
}
