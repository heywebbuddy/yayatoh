import { randomBytes } from 'node:crypto';
import {
  assignCommand,
  assistanceTicketToken,
  guestRequestCommand,
  updateCommand as updateAssistanceCommand,
} from '@yayatoh/assistance';
import { createTemplateCommand, startPrintJobCommand } from '@yayatoh/badges';
import { setCeSettingsCommand, setSessionRuleCommand } from '@yayatoh/ce';
import { sql } from '@yayatoh/db';
import {
  addMeetingSlotsCommand,
  askQuestionCommand,
  createPollCommand,
  directoryQuery,
  enableLiveCommand,
  moderateQuestionCommand,
  myMeetingsQuery,
  openPollCommand,
  optInCommand,
  requestConnectionCommand,
  requestMeetingCommand,
  respondConnectionCommand,
  respondMeetingCommand,
  saveMeetingLocationCommand,
  updateSettingsCommand as updateLiveSettingsCommand,
  updateNetworkSettingsCommand,
  voteCommand,
} from '@yayatoh/engagement';
import {
  assignBoothCommand,
  createExhibitorCommand,
  createRoomCommand,
  createSessionCommand,
  createSessionTypeCommand,
  createSpeakerCommand,
  createSponsorCommand,
  createSponsorTierCommand,
  createTrackCommand,
  publishAgendaCommand,
  saveBoothCommand,
  saveExhibitorListingCommand,
  saveSponsorPackageCommand,
  setSessionAgendaCommand,
} from '@yayatoh/program';
import { seedRegistrationDefaultsCommand } from '@yayatoh/registration';
import { createSurveyCommand } from '@yayatoh/surveys';
import { createStreamCommand, setTicketAccessCommand } from '@yayatoh/virtual';
import {
  type Built,
  buildEvent,
  checkIns,
  complete,
  type EventSpec,
  existing,
  promoCodes,
  publish,
  sell,
  ticketTypes,
  type VenueKey,
} from './common.ts';
import {
  addDays,
  addMinutes,
  ask,
  at,
  type Demo,
  dayOf,
  log,
  owner,
  people,
  read,
  run,
  step,
  ticketsOf,
  visitor,
} from './kit.ts';

const SPEAKERS = [
  [
    'Dr. Anjali Rao',
    'Chief Scientist',
    'Nimbus Labs',
    'Works on applied AI for healthcare and teaches at IISc.',
  ],
  [
    'Marcus Lee',
    'VP Engineering',
    'Northwind Cloud',
    'Built distributed systems serving a billion requests a day.',
  ],
  [
    'Fatima Haddad',
    'Head of Design',
    'Studio Meridian',
    'Leads product design for fintech in emerging markets.',
  ],
  ['Rajiv Menon', 'Founder', 'Kite Robotics', 'Second-time founder building warehouse robots in Pune.'],
  ['Sarah Okafor', 'Director of People', 'Contoso Group', 'Writes about hybrid teams and the four-day week.'],
  [
    'Kenji Watanabe',
    'Principal Engineer',
    'Lumen Data',
    'Maintains open-source streaming tools used across Asia.',
  ],
  ['Priya Venkatesh', 'Partner', 'Banyan Ventures', 'Invests in climate and deep-tech startups.'],
  ['Diego Alvarez', 'Product Lead', 'Orbit Payments', 'Shipped UPI integrations for global merchants.'],
] as const;

const SESSIONS: {
  day: 0 | 1;
  time: string;
  minutes: number;
  title: string;
  type: string;
  room: number;
  track: number;
  speakers: number[];
}[] = [
  {
    day: 0,
    time: '09:30',
    minutes: 45,
    title: 'Opening keynote: the next ten years of work',
    type: 'Keynote',
    room: 0,
    track: 0,
    speakers: [0],
  },
  {
    day: 0,
    time: '10:30',
    minutes: 40,
    title: 'Scaling engineering teams across time zones',
    type: 'Talk',
    room: 1,
    track: 1,
    speakers: [1],
  },
  {
    day: 0,
    time: '10:30',
    minutes: 40,
    title: 'Designing for the next billion users',
    type: 'Talk',
    room: 2,
    track: 2,
    speakers: [2],
  },
  {
    day: 0,
    time: '11:30',
    minutes: 60,
    title: 'Panel: building hardware startups in India',
    type: 'Panel',
    room: 0,
    track: 0,
    speakers: [3, 6],
  },
  {
    day: 0,
    time: '14:00',
    minutes: 90,
    title: 'Workshop: shipping your first ML model',
    type: 'Workshop',
    room: 3,
    track: 1,
    speakers: [5],
  },
  {
    day: 0,
    time: '14:00',
    minutes: 40,
    title: 'Hybrid teams that actually work',
    type: 'Talk',
    room: 1,
    track: 2,
    speakers: [4],
  },
  {
    day: 0,
    time: '16:00',
    minutes: 40,
    title: 'Payments everywhere: lessons from UPI',
    type: 'Talk',
    room: 2,
    track: 1,
    speakers: [7],
  },
  {
    day: 1,
    time: '09:30',
    minutes: 45,
    title: 'Keynote: AI in the clinic',
    type: 'Keynote',
    room: 0,
    track: 0,
    speakers: [0],
  },
  {
    day: 1,
    time: '10:30',
    minutes: 40,
    title: 'Streaming data without the pain',
    type: 'Talk',
    room: 1,
    track: 1,
    speakers: [5],
  },
  {
    day: 1,
    time: '10:30',
    minutes: 40,
    title: 'Investing in climate tech',
    type: 'Talk',
    room: 2,
    track: 0,
    speakers: [6],
  },
  {
    day: 1,
    time: '11:30',
    minutes: 90,
    title: 'Workshop: design systems in a day',
    type: 'Workshop',
    room: 3,
    track: 2,
    speakers: [2],
  },
  {
    day: 1,
    time: '14:00',
    minutes: 60,
    title: 'Panel: the four-day week',
    type: 'Panel',
    room: 0,
    track: 2,
    speakers: [4, 1],
  },
  {
    day: 1,
    time: '15:30',
    minutes: 40,
    title: 'Robots in the warehouse',
    type: 'Talk',
    room: 1,
    track: 1,
    speakers: [3],
  },
  {
    day: 1,
    time: '16:30',
    minutes: 30,
    title: 'Closing remarks and awards',
    type: 'Keynote',
    room: 0,
    track: 0,
    speakers: [],
  },
];

/** A conference: passes, registration, agenda, speakers, sponsors, exhibitors, networking, live Q&A. */
export async function conference(d: Demo, venues: Record<VenueKey, string>, spec: EventSpec, tag: string) {
  if (await existing(d, spec.slug)) return log(`${spec.slug} exists, skipped`);
  const b = await buildEvent(d, venues, { ...spec, attendanceMode: 'hybrid' });
  const ctx = (now?: Date) => owner(d, now);
  const t = await ticketTypes(d, b, [
    {
      name: 'Full conference pass',
      priceMinor: 29_900,
      quantityTotal: 400,
      description: 'Both days, all talks and workshops, lunch included.',
      earlyPriceMinor: 24_900,
    },
    {
      name: 'VIP pass',
      priceMinor: 59_900,
      quantityTotal: 60,
      description: 'Reserved seating, the speakers’ dinner and the VIP lounge.',
    },
    {
      name: 'Student pass',
      priceMinor: 0,
      quantityTotal: 100,
      description: 'Free with a valid student ID at the door.',
    },
    {
      name: 'Virtual pass',
      priceMinor: 9_900,
      quantityTotal: 1000,
      description: 'Watch every session live and on demand.',
    },
  ]);
  await step(`${b.slug} registration defaults`, () =>
    run(seedRegistrationDefaultsCommand, { eventId: b.id }, ctx()),
  );

  // Program: tracks, rooms, session types, speakers and the two-day agenda.
  const tracks: string[] = [];
  for (const name of ['Leadership', 'Engineering', 'Design & people']) {
    const r = await step(`${b.slug} track ${name}`, () =>
      run<unknown, { id: string }>(createTrackCommand, { eventId: b.id, name }, ctx()),
    );
    if (r) tracks.push(r.id);
  }
  const rooms: string[] = [];
  for (const [name, capacity] of [
    ['Main hall', 800],
    ['Hall B', 250],
    ['Hall C', 200],
    ['Workshop room', 60],
  ] as const) {
    const r = await step(`${b.slug} room ${name}`, () =>
      run<unknown, { id: string }>(createRoomCommand, { eventId: b.id, name, capacity }, ctx()),
    );
    if (r) rooms.push(r.id);
  }
  const types: Record<string, string> = {};
  for (const name of ['Keynote', 'Talk', 'Panel', 'Workshop']) {
    const r = await step(`${b.slug} session type ${name}`, () =>
      run<unknown, { id: string }>(createSessionTypeCommand, { eventId: b.id, name }, ctx()),
    );
    if (r) types[name] = r.id;
  }
  const speakers: string[] = [];
  for (const [name, title, company, bio] of SPEAKERS) {
    const r = await step(`${b.slug} speaker ${name}`, () =>
      run<unknown, { id: string }>(
        createSpeakerCommand,
        {
          eventId: b.id,
          name,
          title,
          company,
          bio,
          links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/' }],
        },
        ctx(),
      ),
    );
    if (r) speakers.push(r.id);
  }
  const sessions: { id: string; title: string; startsAt: Date; endsAt: Date }[] = [];
  for (const s of SESSIONS) {
    const startsAt = at(dayOf(addDays(b.startsAt, s.day), d.timezone), s.time, d.timezone);
    const endsAt = addMinutes(startsAt, s.minutes);
    const r = await step(`${b.slug} session ${s.title}`, () =>
      run<unknown, { session: { id: string } }>(
        createSessionCommand,
        {
          eventId: b.id,
          title: s.title,
          description: `${s.title}. Bring your questions: there is time for Q&A at the end.`,
          startsAt,
          endsAt,
          roomId: rooms[s.room] ?? null,
          trackId: tracks[s.track] ?? null,
          capacity: s.type === 'Workshop' ? 60 : null,
          speakerIds: s.speakers.map((i) => speakers[i]).filter(Boolean),
        },
        ctx(),
      ),
    );
    if (!r) continue;
    sessions.push({ id: r.session.id, title: s.title, startsAt, endsAt });
    const typeId = types[s.type];
    if (typeId)
      await step(`${b.slug} agenda ${s.title}`, () =>
        run(
          setSessionAgendaCommand,
          {
            eventId: b.id,
            sessionId: r.session.id,
            typeId,
            admission: s.type === 'Workshop' ? 'optional' : 'included',
          },
          ctx(),
        ),
      );
  }
  await step(`${b.slug} publish agenda`, () => run(publishAgendaCommand, { eventId: b.id }, ctx()));
  log(`${b.slug}: ${speakers.length} speakers, ${sessions.length} sessions`);

  // Sponsors, exhibitors and booths.
  const tiers: string[] = [];
  for (const [i, name] of ['Platinum', 'Gold', 'Silver'].entries()) {
    const r = await step(`${b.slug} tier ${name}`, () =>
      run<unknown, { id: string }>(createSponsorTierCommand, { eventId: b.id, name, position: i + 1 }, ctx()),
    );
    if (r) tiers.push(r.id);
  }
  const sponsorNames = [
    ['Nimbus Technologies', 0],
    ['Northwind Cloud', 1],
    ['Orbit Payments', 1],
    ['Banyan Ventures', 2],
    ['Lumen Data', 2],
    ['Kite Robotics', 2],
  ] as const;
  for (const [name, tier] of sponsorNames)
    if (tiers[tier])
      await step(`${b.slug} sponsor ${name}`, () =>
        run(
          createSponsorCommand,
          {
            eventId: b.id,
            tierId: tiers[tier],
            name,
            description: `${name} supports builders across India.`,
            websiteUrl: 'https://example.com/',
          },
          ctx(),
        ),
      );
  if (tiers[1])
    await step(`${b.slug} sponsor package`, () =>
      run(
        saveSponsorPackageCommand,
        {
          eventId: b.id,
          tierId: tiers[1],
          description: 'Logo on the website and badges, a booth, 4 passes and 2 lead licences.',
          priceMinor: 500_000,
          quantity: 5,
          onSale: true,
          compRegistrations: 4,
          exhibitorBadges: 4,
          leadLicenses: 2,
          logoPlacements: ['website', 'badges', 'signage'],
          sessionSlots: 0,
          deliverables: [{ title: 'Send your logo (SVG)', owner: 'sponsor', daysBefore: 30 }],
        },
        ctx(),
      ),
    );
  const exhibitors = [
    'Kite Robotics',
    'Lumen Data',
    'Studio Meridian',
    'Orbit Payments',
    'GreenGrid Energy',
    'Chai & Code',
  ];
  for (const [i, name] of exhibitors.entries()) {
    const ex = await step(`${b.slug} exhibitor ${name}`, () =>
      run<unknown, { id: string }>(
        createExhibitorCommand,
        {
          eventId: b.id,
          name,
          description: `Meet ${name} at booth ${i + 1}.`,
          boothLabel: `B${i + 1}`,
          websiteUrl: 'https://example.com/',
        },
        ctx(),
      ),
    );
    if (!ex) continue;
    await step(`${b.slug} listing ${name}`, () =>
      run(
        saveExhibitorListingCommand,
        {
          eventId: b.id,
          exhibitorId: ex.id,
          listed: true,
          categories: [i % 2 ? 'Software' : 'Hardware'],
          links: [],
          staffAllowance: null,
        },
        ctx(),
      ),
    );
    const booth = await step(`${b.slug} booth B${i + 1}`, () =>
      run<unknown, { booths?: { id: string; number: string }[] }>(
        saveBoothCommand,
        {
          eventId: b.id,
          number: `B${i + 1}`,
          category: 'Standard',
          x: 200 + i * 400,
          y: 300,
          width: 300,
          height: 300,
        },
        ctx(),
      ),
    );
    const boothId = booth?.booths?.find((x) => x.number === `B${i + 1}`)?.id;
    if (boothId)
      await step(`${b.slug} assign booth`, () =>
        run(assignBoothCommand, { eventId: b.id, boothId, exhibitorId: ex.id, primary: true }, ctx()),
      );
  }

  await promoCodes(d, b, tag.toUpperCase());
  await publish(d, b);

  // Passes: 44 buyers across the four types.
  const buyers = people(d, tag, 44);
  const pass = (i: number) =>
    i % 9 === 0
      ? 'VIP pass'
      : i % 7 === 0
        ? 'Student pass'
        : i % 5 === 0
          ? 'Virtual pass'
          : 'Full conference pass';
  await sell(
    d,
    b,
    buyers
      .map((buyer, i) => ({ buyer, id: t[pass(i)] }))
      .filter((o): o is { buyer: (typeof buyers)[number]; id: string } => Boolean(o.id))
      .map((o, i) => ({ buyer: o.buyer, items: [{ ticketTypeId: o.id, quantity: i % 6 === 0 ? 2 : 1 }] })),
  );

  // Virtual: the virtual pass is online only; the keynotes are streamed.
  if (t['Virtual pass'])
    await step(`${b.slug} virtual access`, () =>
      run(
        setTicketAccessCommand,
        { eventId: b.id, ticketTypeId: t['Virtual pass'], access: 'virtual' },
        ctx(),
      ),
    );
  for (const s of sessions.filter((x) => /keynote|Keynote/.test(x.title)).slice(0, 2))
    await step(`${b.slug} stream ${s.title}`, () =>
      run(createStreamCommand, { eventId: b.id, sessionId: s.id }, ctx()),
    );

  // CE credits for the workshops and keynotes.
  await step(`${b.slug} ce settings`, () =>
    run(
      setCeSettingsCommand,
      { eventId: b.id, creditLabel: 'CPD hours', accreditor: 'Demo Professional Council' },
      ctx(),
    ),
  );
  for (const s of sessions.filter((x) => /Workshop|keynote|Keynote/.test(x.title)))
    await step(`${b.slug} ce rule`, () =>
      run(
        setSessionRuleCommand,
        {
          eventId: b.id,
          sessionId: s.id,
          credits: /Workshop/.test(s.title) ? 150 : 50,
          minMinutes: 30,
          countInPerson: true,
          countVirtual: true,
        },
        ctx(),
      ),
    );

  // Badges: a template and the first prints at the desk.
  const template = await step(`${b.slug} badge template`, () =>
    run<unknown, { id: string }>(
      createTemplateCommand,
      { eventId: b.id, name: 'Attendee badge', size: 'fold_4x3' },
      ctx(),
    ),
  );
  const tickets = await ticketsOf(d, b.id);
  if (template)
    for (const tk of tickets.slice(0, 12))
      await step(`${b.slug} badge print`, () =>
        run(
          startPrintJobCommand,
          {
            eventId: b.id,
            ticketId: tk.ticket_id,
            printerId: null,
            source: 'desk',
            locale: 'en',
            requestKey: `demo-${tk.ticket_id}`,
          },
          ctx(b.past ? addMinutes(b.startsAt, -30) : undefined),
        ),
      );

  // Post-event survey (created, never sent from the seed).
  await step(`${b.slug} survey`, () =>
    run(
      createSurveyCommand,
      {
        eventId: b.id,
        kind: 'post_event',
        title: 'How was the summit?',
        intro: 'Two minutes of feedback helps us plan next year.',
        definition: {
          fields: [
            { key: 'overall', type: 'rating', label: 'Overall, how was the event?', required: true },
            {
              key: 'recommend',
              type: 'nps',
              label: 'How likely are you to recommend it to a colleague?',
              required: true,
            },
            {
              key: 'best',
              type: 'select',
              label: 'Best part',
              options: [
                { value: 'talks', label: 'Talks' },
                { value: 'workshops', label: 'Workshops' },
                { value: 'networking', label: 'Networking' },
              ],
            },
            { key: 'improve', type: 'long_text', label: 'What should we improve?' },
          ],
        },
      },
      ctx(),
    ),
  );

  await networking(d, b, tickets, sessions);
  await assistance(d, b, tickets);
  await checkIns(d, b);
  await complete(d, b);
}

async function networking(
  d: Demo,
  b: Built,
  tickets: Awaited<ReturnType<typeof ticketsOf>>,
  sessions: { id: string; title: string; startsAt: Date; endsAt: Date }[],
) {
  const ctx = () => owner(d);
  const on = await step(`${b.slug} networking`, () =>
    run(updateNetworkSettingsCommand, { eventId: b.id, enabled: true, meetingsEnabled: true }, ctx()),
  );
  if (!on) return;
  const loc = await step(`${b.slug} meeting point`, () =>
    run<unknown, { id: string }>(
      saveMeetingLocationCommand,
      { eventId: b.id, name: 'Meeting lounge', kind: 'meeting_point', capacity: 10 },
      ctx(),
    ),
  );
  await step(`${b.slug} booth point`, () =>
    run(saveMeetingLocationCommand, { eventId: b.id, name: 'Booth B2', kind: 'booth', capacity: 2 }, ctx()),
  );
  if (!b.past) {
    // Meeting slots over the first day's lunch break.
    await step(`${b.slug} meeting slots`, () =>
      run(
        addMeetingSlotsCommand,
        {
          eventId: b.id,
          startsAt: addMinutes(b.startsAt, 210),
          endsAt: addMinutes(b.startsAt, 300),
          minutes: 15,
        },
        ctx(),
      ),
    );
  }
  // Twelve attendees opt in with profiles (only people with an active ticket can).
  const interests = [
    'AI, Healthcare',
    'Design, Fintech',
    'Engineering, Data',
    'Climate, Investing',
    'Robotics, Hardware',
    'People, Remote work',
  ];
  const unique = [...new Map(tickets.map((t) => [t.email, t])).values()].slice(0, 12);
  for (const [i, t] of unique.entries())
    await step(`${b.slug} opt-in ${t.email}`, () =>
      run(
        optInCommand,
        {
          eventId: b.id,
          email: t.email,
          displayName: t.name,
          headline: ['Product manager', 'Engineer', 'Designer', 'Founder', 'Investor', 'HR lead'][i % 6],
          company: [
            'Acme India',
            'Nimbus Labs',
            'Studio Meridian',
            'Kite Robotics',
            'Banyan Ventures',
            'Contoso',
          ][i % 6],
          bio: 'Here to meet people working on similar problems.',
          interests: interests[i % interests.length],
          consent: true,
        },
        visitor(d),
      ),
    );
  if (b.past || unique.length < 4) return;
  // A few connections and one meeting booked for the upcoming event.
  for (let i = 0; i + 1 < 6; i += 2) {
    const a = unique[i] as (typeof unique)[number];
    const c = unique[i + 1] as (typeof unique)[number];
    await step(`${b.slug} connection`, async () => {
      const dir = await ask<unknown, { people: { id: string; displayName: string }[] }>(
        directoryQuery,
        { eventId: b.id, email: a.email },
        visitor(d),
      );
      const person = dir.people.find((p) => p.displayName === c.name);
      if (!person) throw new Error('person not in directory');
      const req = await run<unknown, { id: string }>(
        requestConnectionCommand,
        { eventId: b.id, email: a.email, personId: person.id, message: 'Great to meet you at the summit!' },
        visitor(d),
      );
      await run(
        respondConnectionCommand,
        { eventId: b.id, email: c.email, connectionId: req.id, accept: true },
        visitor(d),
      );
      if (i === 0 && loc) {
        const mine = await ask<unknown, { slots: { id: string }[] }>(
          myMeetingsQuery,
          { eventId: b.id, email: a.email },
          visitor(d),
        );
        const slot = mine.slots[0];
        if (slot) {
          const m = await run<unknown, { id: string }>(
            requestMeetingCommand,
            {
              eventId: b.id,
              email: a.email,
              personId: person.id,
              slotId: slot.id,
              locationId: loc.id,
              message: 'Coffee after the keynote?',
            },
            visitor(d),
          );
          await run(
            respondMeetingCommand,
            { eventId: b.id, email: c.email, meetingId: m.id, accept: true },
            visitor(d),
          );
        }
      }
    });
  }
  // Live polls and Q&A on the opening keynote.
  const keynote = sessions[0];
  if (!keynote) return;
  await step(`${b.slug} live`, async () => {
    await run(enableLiveCommand, { eventId: b.id, sessionId: keynote.id }, ctx());
    await run(
      updateLiveSettingsCommand,
      {
        eventId: b.id,
        sessionId: keynote.id,
        qaOpen: true,
        allowAnonymous: true,
        anonymousIdentity: 'hidden',
      },
      ctx(),
    );
    const poll = await run<unknown, { id: string }>(
      createPollCommand,
      {
        eventId: b.id,
        sessionId: keynote.id,
        kind: 'single',
        question: 'Where do you work most days?',
        options: ['Office', 'Home', 'Both', 'Co-working space'],
      },
      ctx(),
    );
    await run(openPollCommand, { eventId: b.id, pollId: poll.id }, ctx());
    for (let v = 0; v < 18; v += 1)
      await run(
        voteCommand,
        {
          eventId: b.id,
          pollId: poll.id,
          participantKey: randomBytes(32).toString('base64url'),
          optionIds: [`o${(v % 4) + 1}`],
        },
        visitor(d),
      );
    const questions = [
      'How do you keep culture alive across time zones?',
      'What changed your mind most in the last year?',
      'Which tools do you recommend for async work?',
    ];
    for (const [k, body] of questions.entries())
      await run(
        askQuestionCommand,
        {
          eventId: b.id,
          sessionId: keynote.id,
          participantKey: randomBytes(32).toString('base64url'),
          body,
          name: unique[k]?.name ?? 'Guest',
          anonymous: false,
        },
        visitor(d),
      );
    const asked = await read<{ id: string } & Record<string, unknown>>(
      d,
      sql`select id from engagement.questions where session_id = ${keynote.id} order by created_at`,
    );
    for (const q of asked)
      await run(moderateQuestionCommand, { eventId: b.id, questionId: q.id, action: 'approve' }, ctx());
    if (asked[0])
      await run(moderateQuestionCommand, { eventId: b.id, questionId: asked[0].id, action: 'answer' }, ctx());
  });
}

async function assistance(d: Demo, b: Built, tickets: Awaited<ReturnType<typeof ticketsOf>>) {
  const when = b.past ? addMinutes(b.startsAt, 90) : undefined;
  const reqs: [string, string, string][] = [
    ['accessibility', 'Needs a seat near the aisle for a wheelchair.', 'Main hall, row C'],
    ['lost_item', 'Left a laptop bag in Hall B after the morning session.', 'Hall B'],
    ['medical', 'Feeling unwell, needs water and somewhere to sit.', 'Registration desk'],
  ];
  for (const [i, [reason, note, location]] of reqs.entries()) {
    const t = tickets[i * 3];
    if (!t) continue;
    const r = await step(`${b.slug} assistance ${reason}`, () =>
      run<unknown, { requestId: string }>(
        guestRequestCommand,
        { eventId: b.id, ticketToken: assistanceTicketToken(t.ticket_id), reason, note, location },
        visitor(d, when),
      ),
    );
    if (r && i < 2) {
      await step(`${b.slug} assistance assign`, () =>
        run(assignCommand, { eventId: b.id, requestId: r.requestId, assignee: 'me' }, owner(d, when)),
      );
      if (i === 0)
        await step(`${b.slug} assistance resolve`, () =>
          run(
            updateAssistanceCommand,
            { eventId: b.id, requestId: r.requestId, action: 'resolve' },
            owner(d, when),
          ),
        );
    }
  }
}
