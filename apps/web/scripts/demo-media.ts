import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closePools, sql, withTenant } from '@yayatoh/db';
import {
  completeGalleryUploadCommand,
  directUploadTarget,
  removeGalleryItemCommand,
  requestGalleryUploadCommand,
  runGalleryCommand,
  storeDirectUpload,
} from '@yayatoh/gallery';
import { createCtx } from '@yayatoh/kernel';
import { removeMedia, uploadMedia, uploadProgramImage } from '@yayatoh/media';
import { setTableSponsorCommand } from '@yayatoh/seating';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { getAuth } from '../src/server/auth.ts';
import { VENUES } from './demo/common.ts';
import { type Demo, failures, log, owner, quietPorts, read, run, step } from './demo/kit.ts';

/*
 * Replace the demo data's placeholder images with real ones (generated photos and original logos):
 *   DEMO_ORG_SLUG=webbuddy DEMO_OWNER_EMAIL=ratnesh@webbuddy.agency DEMO_IMAGES_DIR=/tmp/demo-images \
 *   node --conditions=react-server scripts/demo-media.ts
 * Files: <key>-cover-1.jpg, <key>-gallery-<n>.jpg (key per event below) and logo-<company>.svg.
 * An event without files for a slot keeps what it has. Safe to re-run.
 */
const slug = process.env.DEMO_ORG_SLUG;
const ownerEmail = process.env.DEMO_OWNER_EMAIL?.toLowerCase();
const dir = process.env.DEMO_IMAGES_DIR;
if (!slug || !ownerEmail || !dir) throw new Error('Set DEMO_ORG_SLUG, DEMO_OWNER_EMAIL and DEMO_IMAGES_DIR');
const resolved = await resolveOrgSlug(slug);
const user = await (await getAuth().$context).internalAdapter.findUserByEmail(ownerEmail);
if (!resolved || !user) throw new Error('Unknown org or owner');
const [org] = await withTenant(
  createCtx({ orgId: resolved.orgId, actor: { type: 'system', name: 'demo-media' } }),
  (tx) =>
    tx.execute<{ timezone: string; currency: string }>(
      sql`select timezone, currency from tenancy.organizations where id = ${resolved.orgId}`,
    ),
);
const d: Demo = {
  orgId: resolved.orgId,
  ownerId: user.user.id,
  timezone: org?.timezone ?? 'UTC',
  currency: org?.currency ?? 'USD',
  attendeeEmail: () => '',
};

const files = readdirSync(dir);
const keyOf = (k: string) => (files.some((f) => f.startsWith(`${k}-cover-`)) ? k : (BORROW[k] ?? k));
const file = (name: string) => (files.includes(name) ? new Uint8Array(readFileSync(join(dir, name))) : null);
const gallery = (key: string) =>
  files
    .filter((f) => f.startsWith(`${key}-gallery-`) && f.endsWith('.jpg'))
    .sort()
    .map((f) => new Uint8Array(readFileSync(join(dir, f))));

const KEYS: Record<string, { key: string; alt: string }> = {
  'demo-wedding-ananya-rohan': { key: 'wed1', alt: 'The lakeside mandap at golden hour' },
  'demo-wedding-meera-daniel': { key: 'wed2', alt: 'A garden wedding ceremony at sunrise' },
  'demo-gala-starlight-charity': { key: 'gala1', alt: 'The ballroom set for the charity gala' },
  'demo-gala-founders-circle': { key: 'gala2', alt: 'Candlelit tables at the donors’ dinner' },
  'demo-concert-sunset-sessions': { key: 'live1', alt: 'The open-air stage at sunset' },
  'demo-concert-monsoon-jazz': { key: 'live2', alt: 'The jazz quartet on stage' },
  'demo-conference-future-of-work': { key: 'fow', alt: 'The keynote stage in the main hall' },
  'demo-conference-devcon-india': { key: 'dev', alt: 'A packed auditorium at DevCon' },
  'demo-community-beach-cleanup': { key: 'beach', alt: 'Volunteers on the beach at sunrise' },
  'demo-community-goa-food-festival': { key: 'food', alt: 'Food stalls under string lights' },
  'demo-agency-nimbus-launch': { key: 'nimbus', alt: 'The launch stage with green lighting' },
  'demo-agency-partner-meet': { key: 'partner', alt: 'Partner awards on stage' },
  'demo-other-pottery-workshop': { key: 'pottery', alt: 'Hands shaping clay on a pottery wheel' },
  'demo-other-heritage-photo-walk': { key: 'photo', alt: 'A photo walk through Old Delhi' },
  // The base seed's marketplace events, so every card on the home page has a real picture.
  'harbor-spring-concert': { key: 'live1', alt: 'The open-air stage at sunset' },
  'harbor-autumn-gala': { key: 'gala2', alt: 'Candlelit tables at the donors’ dinner' },
  'harbor-film-night': { key: 'live2', alt: 'The stage lit for the film night' },
  'harbor-winter-show': { key: 'nimbus', alt: 'The winter show stage' },
};
/** Events whose own pictures are not in the folder borrow the best-fitting set. */
const BORROW: Record<string, string> = { pottery: 'food', photo: 'beach' };
const HARBOR_WORKSHOP = /^harbor-workshop-/;
/** Each demo venue gets the cover of the event it hosts. */
const VENUE_IMAGE: Record<keyof typeof VENUES, string> = {
  palace: 'wed1',
  ballroom: 'gala1',
  arena: 'live1',
  convention: 'fow',
  hall: 'food',
  studio: 'nimbus',
};
const logoName = (company: string) =>
  `logo-${company
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}.svg`;

const events = await read<
  { id: string; slug: string; name: string; profile: string } & Record<string, unknown>
>(
  d,
  sql`select id, slug, name, profile from events.events where slug like 'demo-%' or slug like 'harbor-%' order by starts_at`,
);
for (const ev of events) {
  const base =
    KEYS[ev.slug] ?? (HARBOR_WORKSHOP.test(ev.slug) ? { key: 'food', alt: 'A hands-on workshop' } : null);
  if (!base) continue;
  const k = { ...base, key: keyOf(base.key) };
  const cover = file(`${k.key}-cover-1.jpg`);
  if (cover)
    await step(`${ev.slug} cover`, () =>
      uploadMedia(
        owner(d),
        { file: cover, ownerType: 'event', ownerId: ev.id, slot: 'cover', alt: k.alt } as never,
        quietPorts,
      ),
    );
  const photos = gallery(k.key);
  if (photos.length) {
    const old = await read<{ id: string } & Record<string, unknown>>(
      d,
      sql`select id from media.assets where owner_type = 'event' and owner_id = ${ev.id} and slot = 'gallery'`,
    );
    for (const a of old)
      await step(`${ev.slug} remove old photo`, () => removeMedia(owner(d), { assetId: a.id }, quietPorts));
    for (const [i, bytes] of photos.entries())
      await step(`${ev.slug} photo ${i + 1}`, () =>
        uploadMedia(
          owner(d),
          {
            file: bytes,
            ownerType: 'event',
            ownerId: ev.id,
            slot: 'gallery',
            alt: `${ev.name.replace(/^Demo · /, '')}: photo ${i + 1}`,
          } as never,
          quietPorts,
        ),
      );
  }
  // The wedding guest gallery: the hosts' photos are the wedding's real ones.
  if (ev.profile === 'wedding' && photos.length) {
    const items = await read<{ id: string } & Record<string, unknown>>(
      d,
      sql`select id from gallery.items where event_id = ${ev.id} and kind = 'photo'`,
    );
    for (const it of items)
      await step(`${ev.slug} remove guest photo`, () =>
        runGalleryCommand(removeGalleryItemCommand, { eventId: ev.id, itemId: it.id }, owner(d), quietPorts),
      );
    const captions = [
      'The mandap',
      'Mehendi afternoon',
      'The first dance',
      'Family portrait',
      'Lanterns at night',
    ];
    for (const [i, bytes] of [...photos, ...(cover ? [cover] : [])].entries())
      await step(`${ev.slug} guest photo ${i + 1}`, async () => {
        const slot = await run<unknown, { itemId: string; url: string; headers: Record<string, string> }>(
          requestGalleryUploadCommand,
          { eventId: ev.id, bytes: bytes.byteLength, caption: captions[i % captions.length] },
          owner(d),
        );
        if (slot.url.includes('/api/gallery/direct/')) {
          const target = directUploadTarget(
            decodeURIComponent(slot.url.split('/api/gallery/direct/')[1]?.split('?')[0] ?? ''),
          );
          if (!target || !(await storeDirectUpload(target, bytes))) throw new Error('direct upload refused');
        } else {
          const res = await fetch(slot.url, {
            method: 'PUT',
            headers: slot.headers,
            body: new Blob([bytes]),
          });
          if (!res.ok) throw new Error(`upload ${res.status}`);
        }
        await runGalleryCommand(
          completeGalleryUploadCommand,
          { eventId: ev.id, itemId: slot.itemId },
          owner(d),
          quietPorts,
        );
      });
  }
  // Sponsor and exhibitor logos (and the renamed table sponsors of the galas).
  const sponsors = await read<{ id: string; name: string } & Record<string, unknown>>(
    d,
    sql`select id, name from program.sponsors where event_id = ${ev.id}`,
  );
  for (const s of sponsors) {
    const logo = file(logoName(s.name));
    if (logo)
      await step(`${ev.slug} sponsor logo ${s.name}`, () =>
        uploadProgramImage(
          owner(d),
          'sponsor',
          { file: logo, alt: s.name, ownerId: s.id } as never,
          quietPorts,
        ),
      );
  }
  const exhibitors = await read<{ id: string; name: string } & Record<string, unknown>>(
    d,
    sql`select id, name from program.exhibitors where event_id = ${ev.id}`,
  );
  for (const x of exhibitors) {
    const logo = file(logoName(x.name));
    if (logo)
      await step(`${ev.slug} exhibitor logo ${x.name}`, () =>
        uploadProgramImage(
          owner(d),
          'exhibitor',
          { file: logo, alt: x.name, ownerId: x.id } as never,
          quietPorts,
        ),
      );
  }
  if (ev.profile === 'gala') {
    const renamed: Record<string, string> = {
      'Tata Horizon Foundation': 'Horizon Foundation',
      'Coastal Bank of India': 'Seaside Community Bank',
    };
    const tables = await read<{ item_id: string; sponsor_name: string } & Record<string, unknown>>(
      d,
      sql`select item_id, sponsor_name from seating.table_sponsors where event_id = ${ev.id}`,
    ).catch(() => []);
    for (const t of tables) {
      const name = renamed[t.sponsor_name];
      if (name)
        await step(`${ev.slug} rename table sponsor`, () =>
          run(
            setTableSponsorCommand,
            { eventId: ev.id, itemId: t.item_id, sponsorName: name, published: true },
            owner(d),
          ),
        );
    }
  }
  log(
    `${ev.slug}: ${cover ? 'cover, ' : ''}${photos.length} photos, ${sponsors.length + exhibitors.length} logos checked`,
  );
}

// Venue photos.
const venues = await read<{ id: string; name: string } & Record<string, unknown>>(
  d,
  sql`select id, name from venues.venues`,
);
for (const [key, v] of Object.entries(VENUES) as [
  keyof typeof VENUES,
  (typeof VENUES)[keyof typeof VENUES],
][]) {
  const row = venues.find((x) => x.name === v.name);
  const image = file(`${VENUE_IMAGE[key]}-cover-1.jpg`);
  if (row && image)
    await step(`venue photo ${v.name}`, () =>
      uploadMedia(
        owner(d),
        {
          file: image,
          ownerType: 'venue',
          ownerId: row.id,
          slot: 'photo',
          alt: `${v.name}, ${v.city}`,
        } as never,
        quietPorts,
      ),
    );
}
log(
  failures.length
    ? `done with ${failures.length} failed step(s):\n  ${failures.join('\n  ')}`
    : 'done, every step succeeded',
);
await closePools();
