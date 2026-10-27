import { addMinutesLocal } from './compose.ts';

/**
 * The no-provider fallback of "Create with AI": a rule-based reading of the organizer's sentence.
 * It picks the event type from keywords, the number of days, the city, and builds tickets, an agenda
 * and FAQs that suit the type. It never invents prices beyond modest, editable defaults, and the
 * organizer reviews everything before anything is created, as with the real model.
 */
type Kind = 'wedding' | 'gala' | 'conference' | 'concert' | 'community' | 'tour' | 'agency' | 'other';

const KEYWORDS: readonly (readonly [Kind, RegExp])[] = [
  ['wedding', /\b(wedding|shaadi|marriage|reception|sangeet|mehndi|engagement)\b/i],
  ['gala', /\b(gala|charity dinner|fundrais\w*|benefit dinner|awards? (night|dinner))\b/i],
  ['conference', /\b(conference|summit|congress|symposium|convention|devcon|seminar|expo)\b/i],
  ['concert', /\b(concert|gig|jazz|festival|live music|band|dj|show|recital|music)\b/i],
  ['tour', /\b(tour|walk|trek|cruise|boat|bus ride|excursion|trip|safari)\b/i],
  ['community', /\b(meetup|community|workshop|clean-?up|volunteer|club|class|fair|charity run)\b/i],
  ['agency', /\b(launch|corporate|partner meet|offsite|client event|brand activation|team building)\b/i],
];

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

export function detectKind(brief: string, allowed: readonly string[]): Kind {
  const hit = KEYWORDS.find(([, re]) => re.test(brief))?.[0] ?? 'other';
  return (allowed.includes(hit) ? hit : 'other') as Kind;
}

export function detectDays(brief: string): number {
  const m = /\b(\d|one|two|three|four|five|six|seven)[\s-]*(?:day|days|night|nights)\b/i.exec(brief);
  if (m?.[1]) {
    const n = Number(m[1]) || NUMBER_WORDS[m[1].toLowerCase()] || 1;
    return Math.min(7, Math.max(1, n));
  }
  return /\bweekend\b/i.test(brief) ? 2 : 1;
}

export function detectCity(brief: string): string {
  const m = /\b(?:in|at|near)\s+([A-Z][\p{L}.'-]+(?:\s+[A-Z][\p{L}.'-]+){0,2})/u.exec(brief);
  return m?.[1]?.trim() ?? '';
}

const SMALL = new Set(['in', 'at', 'of', 'the', 'a', 'an', 'and', 'for', 'to', 'on']);
const titleCase = (s: string) =>
  s
    .split(' ')
    .map((w, i) =>
      i > 0 && SMALL.has(w.toLowerCase())
        ? w.toLowerCase()
        : w.replace(/(^|-)(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()),
    )
    .join(' ');

const START_HOUR: Record<Kind, string> = {
  wedding: '16:00',
  gala: '19:00',
  conference: '09:00',
  concert: '20:00',
  community: '10:00',
  tour: '09:30',
  agency: '18:00',
  other: '10:00',
};
const HOURS: Record<Kind, number> = {
  wedding: 7,
  gala: 4,
  conference: 8,
  concert: 4,
  community: 4,
  tour: 3,
  agency: 3,
  other: 3,
};

const LABEL: Record<Kind, string> = {
  wedding: 'wedding',
  gala: 'gala',
  conference: 'conference',
  concert: 'concert',
  community: 'community event',
  tour: 'tour',
  agency: 'corporate event',
  other: 'event',
};

interface Ticket {
  name: string;
  description: string;
  price: number;
  quantity: number;
}
const TICKETS: Record<Kind, Ticket[]> = {
  wedding: [
    { name: 'Guest pass', description: 'Included for every invited guest (RSVP).', price: 0, quantity: 150 },
  ],
  gala: [
    { name: 'Individual seat', description: 'One seat at the gala dinner.', price: 150, quantity: 120 },
    { name: 'Table of 10', description: 'A hosted table for ten guests.', price: 1200, quantity: 12 },
  ],
  conference: [
    { name: 'Early bird', description: 'Limited number at a lower price.', price: 99, quantity: 100 },
    { name: 'Standard', description: 'Full access to the programme.', price: 149, quantity: 300 },
    { name: 'Student', description: 'With a valid student ID.', price: 49, quantity: 50 },
  ],
  concert: [
    { name: 'General admission', description: 'Entry to the show.', price: 35, quantity: 500 },
    { name: 'VIP', description: 'Priority entry and the best view.', price: 90, quantity: 80 },
  ],
  community: [
    { name: 'Free entry', description: 'Everyone is welcome.', price: 0, quantity: 100 },
    { name: 'Supporter', description: 'Chip in to help cover costs.', price: 10, quantity: 50 },
  ],
  tour: [
    { name: 'Adult', description: 'One adult place on the departure.', price: 40, quantity: 30 },
    { name: 'Child', description: 'Ages 4 to 12.', price: 20, quantity: 10 },
  ],
  agency: [{ name: 'Invitation', description: 'For invited guests and partners.', price: 0, quantity: 80 }],
  other: [{ name: 'General admission', description: 'Entry to the event.', price: 25, quantity: 100 }],
};

const AGENDA: Record<Kind, [number, string, string][]> = {
  wedding: [
    [0, 'Guests arrive', 'Welcome drinks and seating.'],
    [60, 'Ceremony', 'The wedding ceremony.'],
    [150, 'Dinner and toasts', 'A shared meal and speeches.'],
    [270, 'Music and dancing', 'The celebration continues.'],
  ],
  gala: [
    [0, 'Reception', 'Arrivals and drinks.'],
    [60, 'Dinner', 'Seated dinner service.'],
    [120, 'Speeches and appeal', 'Hosts, guest speaker and the fundraising appeal.'],
    [180, 'Music and networking', 'Live music and mingling.'],
  ],
  conference: [
    [0, 'Registration and coffee', 'Pick up your badge.'],
    [45, 'Opening keynote', 'The day’s theme.'],
    [135, 'Sessions', 'Parallel talks and workshops.'],
    [270, 'Lunch and networking', 'Meet speakers and attendees.'],
    [360, 'Panel discussion', 'Questions from the floor.'],
  ],
  concert: [
    [0, 'Doors open', 'Entry and bar.'],
    [60, 'Opening act', 'Warm-up set.'],
    [105, 'Headline set', 'The main performance.'],
  ],
  community: [
    [0, 'Welcome and sign-in', 'Meet the hosts.'],
    [30, 'Main activity', 'The heart of the event.'],
    [150, 'Wrap-up', 'Thanks and next steps.'],
  ],
  tour: [
    [0, 'Meet at the pickup point', 'Check in with your guide.'],
    [15, 'Departure', 'The tour sets off.'],
    [105, 'Break', 'Refreshments and photos.'],
  ],
  agency: [
    [0, 'Arrivals', 'Registration and welcome drinks.'],
    [45, 'Presentation', 'The main announcement.'],
    [105, 'Networking', 'Time to talk with the team.'],
  ],
  other: [
    [0, 'Doors open', 'Welcome.'],
    [30, 'Main programme', 'The event itself.'],
  ],
};

const FAQS: Record<Kind, [string, string][]> = {
  wedding: [
    ['How do I RSVP?', 'Use the RSVP link in your invitation to confirm who is coming and any meal choices.'],
    ['Is there a dress code?', 'Details will be shared with the invitation. Ask the hosts if unsure.'],
    ['Can I bring a guest?', 'Please check your invitation: the names on it are the guests invited.'],
  ],
  gala: [
    [
      'What is included in the ticket?',
      'A seat at the dinner and the evening’s programme. Drinks may be extra.',
    ],
    ['Can I buy a whole table?', 'Yes, choose the table ticket and add your guests’ names afterwards.'],
    [
      'Is my donation tax deductible?',
      'It depends on your country and the organizer’s status. Ask the organizer for a receipt.',
    ],
  ],
  conference: [
    [
      'Can I get a refund or transfer my ticket?',
      'See the refund policy on this page. Tickets can be transferred to a colleague.',
    ],
    ['Will sessions be recorded?', 'The organizer will confirm which sessions are recorded.'],
    ['Is there a student discount?', 'Yes, choose the student ticket and bring your ID.'],
  ],
  concert: [
    ['What time do doors open?', 'Doors open one hour before the headline act. See the agenda.'],
    ['Can I bring a bag?', 'Small bags only. Check the venue’s rules at the entrance.'],
    ['Where is my ticket?', 'Your ticket is emailed to you right after checkout.'],
  ],
  community: [
    ['Do I need to register?', 'Registering helps the hosts plan, so please sign up.'],
    ['Is it free?', 'Entry is free; supporter tickets help cover costs.'],
    ['What should I bring?', 'The hosts will confirm anything you need before the day.'],
  ],
  tour: [
    ['Where do we meet?', 'Choose your pickup point when you book; it is shown on your order.'],
    ['What if the weather is bad?', 'The organizer will contact you if a departure changes.'],
    ['Are children welcome?', 'Yes, with the child ticket.'],
  ],
  agency: [
    ['Who can attend?', 'Guests and partners on the invitation list.'],
    ['Where do I check in?', 'At the registration desk on arrival, with your ticket.'],
    ['Is there parking?', 'The venue details will be shared closer to the date.'],
  ],
  other: [
    ['Where do I get my ticket?', 'Your ticket is emailed to you right after checkout.'],
    ['When do doors open?', 'See the agenda for the schedule.'],
    ['Can I get a refund?', 'See the refund policy before you buy.'],
  ],
};

const FILLER = new Set([
  'a',
  'an',
  'the',
  'one',
  'two',
  'three',
  'four',
  'five',
  'day',
  'days',
  'small',
  'big',
  'large',
  'nice',
  'our',
  'my',
  'new',
  'weekend',
  'and',
  'for',
  'with',
  'of',
]);

/** A short event name, not the prompt: "Goa Wedding", "Pune Developer Conference". */
function shortName(text: string, kind: Kind, label: string, city: string): string {
  const re = KEYWORDS.find(([k]) => k === kind)?.[1];
  const m = re ? re.exec(text) : null;
  const before = m
    ? text
        .slice(0, m.index)
        .split(/[\s,]+/)
        .filter(Boolean)
    : [];
  const mods = before
    .slice(-2)
    .filter((w) => !FILLER.has(w.toLowerCase()) && !/^\d|-day$/i.test(w) && /^[\p{L}]+$/u.test(w));
  return titleCase([city, ...mods, label].filter(Boolean).join(' ')).slice(0, 80);
}

export interface RuleBasedSetup {
  readonly name: string;
  readonly tagline: string;
  readonly profile: string;
  readonly startsLocal: string;
  readonly endsLocal: string;
  readonly venueName: string;
  readonly city: string;
  readonly description: string;
  readonly tickets: readonly Ticket[];
  readonly agenda: readonly { title: string; description: string; startsLocal: string; minutes: number }[];
  readonly faqs: readonly { question: string; answer: string }[];
}

/** Read one sentence into a full proposal. `today` is `YYYY-MM-DD`; the event starts 30 days on. */
export function ruleBasedSetup(brief: string, today: string, allowed: readonly string[]): RuleBasedSetup {
  const text = brief.replace(/\s+/g, ' ').trim();
  const kind = detectKind(text, allowed);
  const days = detectDays(text);
  const city = detectCity(text);
  const firstLocal = addMinutesLocal(`${today} 00:00`, 30 * 24 * 60)?.slice(0, 10) ?? today;
  const startsLocal = `${firstLocal} ${START_HOUR[kind]}`;
  const lastDay = addMinutesLocal(`${firstLocal} 00:00`, (days - 1) * 24 * 60)?.slice(0, 10) ?? firstLocal;
  const endsLocal =
    addMinutesLocal(`${lastDay} ${START_HOUR[kind]}`, HOURS[kind] * 60) ??
    addMinutesLocal(startsLocal, 180) ??
    startsLocal;
  const label = LABEL[kind];
  const name = shortName(text, kind, label, city);
  const where = city ? ` in ${city}` : '';
  const span = days > 1 ? `${days}-day ` : '';
  const description = [
    `**${name}** is a ${span}${label}${where}, starting on ${firstLocal}.`,
    `Everything you need to know is on this page: the programme, how to get your ticket and answers to common questions.`,
    `- Dates: ${days > 1 ? `${firstLocal} to ${lastDay}` : firstLocal}\n- Place: ${city || 'to be announced'}\n- Tickets: see the pass options`,
  ].join('\n\n');
  const agenda = (AGENDA[kind] ?? [])
    .slice(0, 8)
    .map(([offset, title, d]) => ({
      title,
      description: d,
      startsLocal: addMinutesLocal(startsLocal, offset) ?? startsLocal,
      minutes: 45,
    }))
    // Every item must sit inside the first day's hours.
    .filter((a) => (addMinutesLocal(a.startsLocal, a.minutes) ?? endsLocal) <= endsLocal);
  return {
    name,
    tagline: `A ${span}${label}${where}.`,
    profile: kind,
    startsLocal,
    endsLocal,
    venueName: city,
    city,
    description,
    tickets: TICKETS[kind],
    agenda,
    faqs: FAQS[kind].map(([question, answer]) => ({ question, answer })),
  };
}
