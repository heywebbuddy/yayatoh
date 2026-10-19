import { markGuestsArrivedCommand } from '@yayatoh/checkin';
import { buildRectTable, buildRoundTable } from '@yayatoh/floorplan';
import {
  addGalleryVideoCommand,
  completeGalleryUploadCommand,
  directUploadTarget,
  requestGalleryUploadCommand,
  runGalleryCommand,
  saveGallerySettingsCommand,
  storeDirectUpload,
} from '@yayatoh/gallery';
import {
  addGuestSiteBlockCommand,
  addPartyGuestCommand,
  addPlusOneCommand,
  createPartyCommand,
  createRsvpLinksCommand,
  createSubEventCommand,
  markRsvpSentCommand,
  publishGuestSiteCommand,
  recordSubEventResponseCommand,
  saveGuestSiteCommand,
  saveMenuOptionCommand,
  setGuestSitePasswordCommand,
  setInvitationsCommand,
  setPartyContactCommand,
  setRsvpSettingsCommand,
  updateGuestSiteBlockCommand,
} from '@yayatoh/guests';
import {
  publishEventLayoutCommand,
  seatGuestsCommand,
  setEventLayoutCommand,
  setVipTableCommand,
} from '@yayatoh/seating';
import {
  type Built,
  buildEvent,
  checkIns,
  complete,
  type EventSpec,
  existing,
  publish,
  type VenueKey,
} from './common.ts';
import {
  addDays,
  addMinutes,
  at,
  type Demo,
  dayOf,
  demoImage,
  log,
  owner,
  PALETTES,
  people,
  quietPorts,
  run,
  step,
} from './kit.ts';

const MENU = [
  'Paneer tikka & dal makhani (veg)',
  'Butter chicken & biryani',
  'Grilled fish & saffron rice',
  'Jain thali',
];
const SUB_EVENTS = [
  { name: 'Mehendi', kind: 'custom', day: 0, start: '16:00', hours: 4, place: 'Garden terrace' },
  { name: 'Sangeet night', kind: 'custom', day: 1, start: '19:00', hours: 4, place: 'Palace courtyard' },
  { name: 'Wedding ceremony', kind: 'ceremony', day: 2, start: '10:00', hours: 3, place: 'Lakeside mandap' },
  { name: 'Reception', kind: 'reception', day: 2, start: '19:00', hours: 4, place: 'Durbar hall' },
] as const;

/** A wedding: guest list, sub-events, RSVPs, menu, seating chart, guest website and photo gallery. */
export async function wedding(d: Demo, venues: Record<VenueKey, string>, spec: EventSpec, tag: string) {
  if (await existing(d, spec.slug)) return log(`${spec.slug} exists, skipped`);
  const b = await buildEvent(d, venues, spec);
  await publish(d, b);
  const ctx = () => owner(d);

  // Sub-events (the wedding days) and the menu.
  const subs: string[] = [];
  for (const s of SUB_EVENTS) {
    const startsAt = at(dayOf(addDays(b.startsAt, s.day), d.timezone), s.start, d.timezone);
    const r = await step(`${b.slug} sub-event ${s.name}`, () =>
      run<unknown, { id: string }>(
        createSubEventCommand,
        {
          eventId: b.id,
          name: s.name,
          kind: s.kind,
          startsAt,
          endsAt: addMinutes(startsAt, s.hours * 60),
          place: s.place,
          venueId: venues[spec.venue],
          inviteAll: false,
        },
        ctx(),
      ),
    );
    if (r) subs.push(r.id);
  }
  for (const label of MENU)
    await step(`${b.slug} menu ${label}`, () => run(saveMenuOptionCommand, { eventId: b.id, label }, ctx()));
  await step(`${b.slug} rsvp settings`, () =>
    run(
      setRsvpSettingsCommand,
      { eventId: b.id, deadline: addDays(b.startsAt, -21), nameLookup: true },
      ctx(),
    ),
  );

  // 14 households on both sides: 2-4 guests each, a few plus-ones, kids, VIPs.
  const sides = ['Bride', 'Groom'];
  const guestIds: { id: string; attending: boolean }[] = [];
  const partyIds: string[] = [];
  const folks = people(d, tag, 60);
  let p = 0;
  for (let h = 0; h < 14; h += 1) {
    const size = 2 + (h % 3);
    const lead = folks[p] as (typeof folks)[number];
    const party = await step(`${b.slug} party ${lead.last}`, () =>
      run<unknown, { id: string }>(
        createPartyCommand,
        {
          eventId: b.id,
          name: `The ${lead.last} family`,
          envelopeName: `Mr & Mrs ${lead.last}`,
          side: sides[h % 2],
          vip: h < 2,
          tags: h < 4 ? ['Family'] : h < 9 ? ['Friends'] : ['Colleagues'],
          notes: h === 3 ? 'Travelling from London; needs airport pickup.' : '',
        },
        ctx(),
      ),
    );
    if (!party) continue;
    partyIds.push(party.id);
    // Most households come; household 6 declines, 10 and 12 haven't answered yet.
    const attending = ![6].includes(h);
    for (let g = 0; g < size; g += 1) {
      const person = folks[p] as (typeof folks)[number];
      p += 1;
      const child = g === size - 1 && h % 4 === 1;
      const guest = await step(`${b.slug} guest ${person.name}`, () =>
        run<unknown, { id: string }>(
          addPartyGuestCommand,
          {
            eventId: b.id,
            partyId: party.id,
            firstName: person.first,
            lastName: lead.last,
            ageClass: child ? 'child' : 'adult',
            meal: MENU[(h + g) % MENU.length],
            dietary: g === 1 && h % 5 === 0 ? 'No nuts' : null,
            isPrimary: g === 0,
          },
          ctx(),
        ),
      );
      if (guest) guestIds.push({ id: guest.id, attending: attending && ![10, 12].includes(h) });
      if (guest && g === 0 && h % 5 === 2) {
        const plus = await step(`${b.slug} plus-one`, () =>
          run<unknown, { id: string }>(
            addPlusOneCommand,
            { eventId: b.id, hostGuestId: guest.id, firstName: 'Guest of', lastName: lead.last },
            ctx(),
          ),
        );
        if (plus) guestIds.push({ id: plus.id, attending });
      }
    }
    await step(`${b.slug} party contact`, () =>
      run(setPartyContactCommand, { eventId: b.id, partyId: party.id, email: lead.email, phone: '' }, ctx()),
    );
  }
  log(`${b.slug}: ${partyIds.length} households, ${guestIds.length} guests`);

  // Everyone is invited to the ceremony and reception; family to every day.
  if (subs.length === 4) {
    await step(`${b.slug} invite all`, () =>
      run(
        setInvitationsCommand,
        { eventId: b.id, subEventIds: [subs[2], subs[3]], target: { kind: 'all' }, invited: true },
        ctx(),
      ),
    );
    await step(`${b.slug} invite family`, () =>
      run(
        setInvitationsCommand,
        {
          eventId: b.id,
          subEventIds: [subs[0], subs[1]],
          target: { kind: 'filter', tag: 'Family' },
          invited: true,
        },
        ctx(),
      ),
    );
  }
  await step(`${b.slug} rsvp links`, () => run(createRsvpLinksCommand, { eventId: b.id }, ctx()));
  for (const id of partyIds)
    await step(`${b.slug} rsvp sent`, () => run(markRsvpSentCommand, { eventId: b.id, partyId: id }, ctx()));
  // Responses for the ceremony and reception (household 6 declined; 10 and 12 pending).
  const declined = new Set(guestIds.filter((g) => !g.attending).map((g) => g.id));
  for (const g of guestIds) {
    for (const sub of subs.slice(2)) {
      const pending = !g.attending && !declined.has(g.id);
      if (pending) continue;
      await step(`${b.slug} rsvp`, () =>
        run(
          recordSubEventResponseCommand,
          { eventId: b.id, guestId: g.id, subEventId: sub, status: g.attending ? 'attending' : 'declined' },
          ctx(),
        ),
      );
    }
  }

  // Seating chart: a head table and ten round tables of 8; attending guests seated by household.
  const head = buildRectTable({ label: 'Head table', seats: 10, x: 1000, y: 260 });
  const tables = Array.from({ length: 10 }, (_, i) =>
    buildRoundTable({
      label: `Table ${i + 1}`,
      seats: 8,
      x: 300 + (i % 5) * 350,
      y: 650 + Math.floor(i / 5) * 400,
    }),
  );
  const objects = [
    {
      kind: 'object',
      id: crypto.randomUUID(),
      objectType: 'stage',
      label: 'Mandap',
      x: 850,
      y: 40,
      width: 300,
      height: 120,
    },
    {
      kind: 'object',
      id: crypto.randomUUID(),
      objectType: 'dance_floor',
      label: 'Dance floor',
      x: 850,
      y: 1400,
      width: 300,
      height: 200,
    },
    {
      kind: 'object',
      id: crypto.randomUUID(),
      objectType: 'bar',
      label: 'Mocktail bar',
      x: 1750,
      y: 1400,
      width: 200,
      height: 120,
    },
  ];
  const laid = await step(`${b.slug} seating chart`, () =>
    run(
      setEventLayoutCommand,
      { eventId: b.id, doc: { version: 1, width: 2000, height: 1700, items: [head, ...tables, ...objects] } },
      ctx(),
    ),
  );
  if (laid) {
    await step(`${b.slug} publish chart`, () => run(publishEventLayoutCommand, { eventId: b.id }, ctx()));
    await step(`${b.slug} vip table`, () =>
      run(setVipTableCommand, { eventId: b.id, subEventId: null, itemId: head.id, vip: true }, ctx()),
    );
    const seated = guestIds.filter((g) => g.attending);
    const chunks = [
      seated.slice(0, 6),
      ...Array.from({ length: 10 }, (_, i) => seated.slice(6 + i * 7, 13 + i * 7)),
    ];
    for (const [i, chunk] of chunks.entries()) {
      if (chunk.length === 0) continue;
      const item = i === 0 ? head : (tables[i - 1] as (typeof tables)[number]);
      await step(`${b.slug} seat ${item.label}`, () =>
        run(
          seatGuestsCommand,
          { eventId: b.id, subEventId: null, itemId: item.id, guestIds: chunk.map((g) => g.id) },
          ctx(),
        ),
      );
    }
  }

  // The guest website (password protected) and the photo gallery.
  await guestSite(d, b, spec, subs);
  await gallery(d, b, tag);
  await checkIns(d, b);
  if (b.past) {
    const arrived = guestIds.filter((g) => g.attending).slice(0, 30);
    for (let i = 0; i < arrived.length; i += 10)
      await step(`${b.slug} arrivals`, () =>
        run(
          markGuestsArrivedCommand,
          { eventId: b.id, guestIds: arrived.slice(i, i + 10).map((g) => g.id) },
          owner(d, addMinutes(b.startsAt, 30 + i)),
        ),
      );
  }
  await complete(d, b);
}

async function guestSite(d: Demo, b: Built, spec: EventSpec, subs: string[]) {
  const ctx = () => owner(d);
  await step(`${b.slug} site`, () =>
    run(
      saveGuestSiteCommand,
      { eventId: b.id, title: spec.name.replace(/^Demo · /, ''), intro: spec.tagline, contentLocale: 'en' },
      ctx(),
    ),
  );
  const blocks: [string, string, unknown][] = [
    ['text', 'Our story', { body: spec.about }],
    ['program', 'The celebrations', { show: 'chosen', subEventIds: subs }],
    [
      'travel',
      'Travel & stay',
      {
        items: [
          {
            title: 'Fly into Udaipur (UDR)',
            details:
              'The palace is a 35-minute drive from the airport. We arrange pickups on the 12th and 13th.',
            url: null,
          },
          {
            title: 'Room block at the palace',
            details: 'Mention the wedding when you book for the family rate.',
            url: 'https://example.com/room-block',
          },
        ],
      },
    ],
    [
      'registry',
      'Gifts',
      { items: [{ label: 'Our honeymoon fund', url: 'https://example.com/honeymoon-fund' }] },
    ],
    ['faq', 'Questions', { items: spec.faq.slice(0, 3) }],
  ];
  for (const [kind, heading, content] of blocks) {
    const block = await step(`${b.slug} site block ${kind}`, () =>
      run<unknown, { blocks?: { id: string; kind: string }[]; id?: string }>(
        addGuestSiteBlockCommand,
        { eventId: b.id, kind },
        ctx(),
      ),
    );
    const id = block?.id ?? block?.blocks?.filter((x) => x.kind === kind).at(-1)?.id;
    if (id)
      await step(`${b.slug} site block ${kind} content`, () =>
        run(updateGuestSiteBlockCommand, { eventId: b.id, blockId: id, heading, content }, ctx()),
      );
  }
  await step(`${b.slug} site password`, () =>
    run(setGuestSitePasswordCommand, { eventId: b.id, password: 'celebrate2026' }, ctx()),
  );
  await step(`${b.slug} site publish`, () =>
    run(publishGuestSiteCommand, { eventId: b.id, published: true }, ctx()),
  );
}

async function gallery(d: Demo, b: Built, tag: string) {
  const ctx = () => owner(d);
  const on = await step(`${b.slug} gallery settings`, () =>
    run(saveGallerySettingsCommand, { eventId: b.id, enabled: true, moderation: 'hold' }, ctx()),
  );
  if (!on) return;
  const captions = [
    'The mandap at sunrise',
    'Mehendi afternoon',
    'First dance',
    'Family portrait',
    'Lanterns on the lake',
    'The sangeet stage',
  ];
  for (const [i, caption] of captions.entries()) {
    await step(`${b.slug} gallery photo ${i + 1}`, async () => {
      const bytes = await demoImage(`${tag}-guest-photo-${i}`, PALETTES.wedding, 1400, 1050);
      const slot = await executeSlot(d, b.id, bytes.byteLength, caption);
      if (slot.url.includes('/api/gallery/direct/')) {
        const token = decodeURIComponent(slot.url.split('/api/gallery/direct/')[1]?.split('?')[0] ?? '');
        const target = directUploadTarget(token);
        if (!target || !(await storeDirectUpload(target, bytes))) throw new Error('direct upload refused');
      } else {
        const res = await fetch(slot.url, {
          method: 'PUT',
          headers: slot.headers,
          body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
        });
        if (!res.ok) throw new Error(`upload ${res.status}`);
      }
      await runGalleryCommand(
        completeGalleryUploadCommand,
        { eventId: b.id, itemId: slot.itemId },
        ctx(),
        quietPorts,
      );
    });
  }
  await step(`${b.slug} gallery video`, () =>
    run(
      addGalleryVideoCommand,
      { eventId: b.id, url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', caption: 'Highlights film' },
      ctx(),
    ),
  );
}

function executeSlot(d: Demo, eventId: string, bytes: number, caption: string) {
  return run<unknown, { itemId: string; url: string; headers: Record<string, string> }>(
    requestGalleryUploadCommand,
    { eventId, bytes, caption },
    owner(d),
  );
}
