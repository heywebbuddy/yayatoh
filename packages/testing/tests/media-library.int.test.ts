import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  catchUpProgramMedia,
  deleteLibraryImage,
  libraryQuery,
  listMediaQuery,
  mediaUsageQuery,
  publicMedia,
  readVariant,
  removeMedia,
  reuseMedia,
  serveTarget,
  storageUsageQuery,
  uploadMedia,
} from '@yayatoh/media';
import { testPng } from '@yayatoh/media/testing';
import { createSpeakerCommand, deleteSpeakerCommand } from '@yayatoh/program';
import { addMemberCommand, organizationBrandTx } from '@yayatoh/tenancy';
import { createVenueCommand } from '@yayatoh/venues';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let managerId: string;
const manager = () => userCtx(managerId, a.org.id);
const viewer = (f: OrgFixture = a) => userCtx(f.viewerId, f.org.id);

const fileOf = (url: string) => {
  const [, , org, asset, file] = url.split('/');
  return { org: org as string, asset: asset as string, file: file as string };
};

/** Objects in the dev store under the org, and their total size. */
async function stored(orgId: string): Promise<{ n: number; bytes: number; keys: string[] }> {
  const rows = await withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ key: string; size: number }>(
      sql`select key, octet_length(data)::int as size from media.blobs order by key`,
    ),
  );
  return { n: rows.length, bytes: rows.reduce((s, r) => s + r.size, 0), keys: rows.map((r) => r.key) };
}

/** Bytes of the stored files of the org's image originals (what the quota counts). */
async function imageFileBytes(orgId: string): Promise<number> {
  const [row] = await withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ bytes: number }>(
      sql`select coalesce(sum(octet_length(b.data)), 0)::int as bytes from media.blobs b
          where exists (select 1 from media.assets a where a.source_asset_id is null
                        and starts_with(b.key, a.org_id::text || '/' || a.id::text || '/'))`,
    ),
  );
  return row?.bytes ?? 0;
}

async function newEvent(ctx: Ctx) {
  return executeCommand(
    createEventCommand,
    {
      name: `Library ${uuidv7().slice(-6)}`,
      timezone: 'America/Chicago',
      startsAt: '2027-11-01T18:00:00Z',
      endsAt: '2027-11-01T22:00:00Z',
    },
    ctx,
    ports,
  );
}

async function newVenue(ctx: Ctx) {
  return executeCommand(
    createVenueCommand,
    { name: `Hall ${uuidv7().slice(-6)}`, country: 'US', timezone: 'America/Chicago' },
    ctx,
    ports,
  );
}

const toLibrary = async (ctx: Ctx, f: OrgFixture = a, alt = 'Crowd at the main stage') =>
  uploadMedia(
    ctx,
    { ownerType: 'library', ownerId: f.org.id, slot: 'library', alt, file: await testPng(80, 50, '#aa3311') },
    ports,
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  managerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: managerId, role: 'manager' }, a.ctx(), ports);
});
afterAll(closePools);

describe('U10 media library: reuse without re-uploading', () => {
  it('reusing an image in two places never duplicates the stored file; usage matches stored files', async () => {
    const before = await stored(a.org.id);
    const usage0 = await executeQuery(mediaUsageQuery, {}, a.ctx(), ports);
    const { asset } = await toLibrary(manager());
    const afterUpload = await stored(a.org.id);
    expect(afterUpload.n).toBe(before.n + asset.variants.length);
    const usage1 = await executeQuery(mediaUsageQuery, {}, a.ctx(), ports);
    expect(usage1.usedBytes - usage0.usedBytes).toBe(asset.bytes);

    const ev = await newEvent(manager());
    const venue = await newVenue(manager());
    const asCover = await reuseMedia(
      manager(),
      {
        sourceAssetId: asset.id,
        target: { ownerType: 'event', ownerId: ev.id, slot: 'cover' },
        alt: 'Main stage',
      },
      ports,
    );
    const asPhoto = await reuseMedia(
      manager(),
      {
        sourceAssetId: asset.id,
        target: { ownerType: 'venue', ownerId: venue.id, slot: 'photo' },
        alt: 'The hall full of people',
      },
      ports,
    );
    // Nothing new in the store; the quota sees no new bytes.
    expect(await stored(a.org.id)).toEqual(afterUpload);
    expect((await executeQuery(mediaUsageQuery, {}, a.ctx(), ports)).usedBytes).toBe(usage1.usedBytes);
    expect(asCover.asset).toMatchObject({
      sourceAssetId: asset.id,
      bytes: 0,
      alt: 'Main stage',
      slot: 'cover',
    });
    expect(asPhoto.asset.variants.map((v) => v.format)).toEqual(asset.variants.map((v) => v.format));
    // Every placement has its own URLs (its own visibility), served from the original's files.
    const f = fileOf(asCover.asset.variants[0]?.url ?? '');
    expect(f.asset).toBe(asCover.asset.id);
    const target = await serveTarget(f.org, f.asset, f.file);
    expect(target).toMatchObject({ storageAssetId: asset.id, ownerType: 'event', visibility: 'none' });
    const bytes = await readVariant(f.org, target?.storageAssetId ?? '', f.file);
    expect(bytes?.byteLength).toBe(target?.bytes);

    // Quota usage is exactly the stored files of the org's originals.
    const usage = await executeQuery(storageUsageQuery, {}, a.ctx(), ports);
    expect(usage.usedBytes).toBe(await imageFileBytes(a.org.id));
    expect(usage.reuses).toBeGreaterThanOrEqual(2);
  });

  it('a reuse is public where it is placed; the library original stays private', async () => {
    const { asset } = await toLibrary(a.ctx());
    const ev = await newEvent(a.ctx());
    const r = await reuseMedia(
      a.ctx(),
      {
        sourceAssetId: asset.id,
        target: { ownerType: 'event', ownerId: ev.id, slot: 'gallery' },
        alt: 'Crowd',
      },
      ports,
    );
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
    const placed = fileOf(r.asset.variants[0]?.url ?? '');
    const original = fileOf(asset.variants[0]?.url ?? '');
    expect((await serveTarget(placed.org, placed.asset, placed.file))?.visibility).toBe('public');
    expect((await serveTarget(original.org, original.asset, original.file))?.visibility).toBe('none');
    expect((await publicMedia('event', ev.id)).map((m) => m.id)).toEqual([r.asset.id]);
    expect(await publicMedia('library', a.org.id)).toEqual([]);
  });

  it('the library lists every original with where it is used; deleting is only for unused images', async () => {
    const { asset } = await toLibrary(a.ctx(), a, 'Lantern parade');
    const ev = await newEvent(a.ctx());
    const placed = await reuseMedia(
      a.ctx(),
      {
        sourceAssetId: asset.id,
        target: { ownerType: 'event', ownerId: ev.id, slot: 'gallery' },
        alt: 'Lanterns',
      },
      ports,
    );
    const lib = await executeQuery(libraryQuery, { limit: 200 }, viewer(), ports);
    const item = lib.items.find((i) => i.asset.id === asset.id);
    expect(item?.usedIn).toEqual([
      expect.objectContaining({
        assetId: placed.asset.id,
        ownerType: 'event',
        label: ev.name,
        eventSlug: ev.slug,
      }),
    ]);
    // Reuses are not library entries of their own.
    expect(lib.items.some((i) => i.asset.id === placed.asset.id)).toBe(false);
    // The fixture's event cover is an original used in its own place.
    expect(lib.items.some((i) => i.usedIn.some((p) => p.slot === 'cover'))).toBe(true);

    await expect(deleteLibraryImage(a.ctx(), { assetId: asset.id }, ports)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'in_use' },
    });
    // An original that sits in its own place is in use too.
    const cover = lib.items.find((i) => i.usedIn.some((p) => p.slot === 'cover' && p.assetId === i.asset.id));
    await expect(
      deleteLibraryImage(a.ctx(), { assetId: cover?.asset.id ?? '' }, ports),
    ).rejects.toMatchObject({
      details: { reason: 'in_use' },
    });

    await removeMedia(a.ctx(), { assetId: placed.asset.id }, ports);
    // Removing the reuse kept the original's files.
    expect((await stored(a.org.id)).keys.filter((k) => k.includes(asset.id))).toHaveLength(
      asset.variants.length,
    );
    const unused = await executeQuery(libraryQuery, { unusedOnly: true, limit: 200 }, a.ctx(), ports);
    expect(unused.items.find((i) => i.asset.id === asset.id)?.usedIn).toEqual([]);
    await deleteLibraryImage(a.ctx(), { assetId: asset.id }, ports);
    expect((await stored(a.org.id)).keys.some((k) => k.includes(asset.id))).toBe(false);
    expect(
      (await executeQuery(libraryQuery, { limit: 200 }, a.ctx(), ports)).items.some(
        (i) => i.asset.id === asset.id,
      ),
    ).toBe(false);
  });

  it('removing a reused original from its place moves it to the library; the reuses keep working', async () => {
    const ev = await newEvent(a.ctx());
    const venue = await newVenue(a.ctx());
    const original = await uploadMedia(
      a.ctx(),
      {
        ownerType: 'venue',
        ownerId: venue.id,
        slot: 'photo',
        alt: 'Hall facade',
        file: await testPng(70, 40),
      },
      ports,
    );
    const reuse = await reuseMedia(
      a.ctx(),
      {
        sourceAssetId: original.asset.id,
        target: { ownerType: 'event', ownerId: ev.id, slot: 'cover' },
        alt: 'Facade of the hall',
      },
      ports,
    );
    await removeMedia(a.ctx(), { assetId: original.asset.id }, ports);
    expect(
      await executeQuery(listMediaQuery, { ownerType: 'venue', ownerId: venue.id }, a.ctx(), ports),
    ).toEqual([]);
    const lib = await executeQuery(libraryQuery, { limit: 200 }, a.ctx(), ports);
    const moved = lib.items.find((i) => i.asset.id === original.asset.id);
    expect(moved?.asset).toMatchObject({ ownerType: 'library', slot: 'library' });
    expect(moved?.usedIn.map((p) => p.assetId)).toEqual([reuse.asset.id]);
    const f = fileOf(reuse.asset.variants[0]?.url ?? '');
    const t = await serveTarget(f.org, f.asset, f.file);
    expect(await readVariant(f.org, t?.storageAssetId ?? '', f.file)).not.toBeNull();

    // Replacing the reuse (a single cover slot) with a new upload purges nothing of the original.
    await uploadMedia(
      a.ctx(),
      { ownerType: 'event', ownerId: ev.id, slot: 'cover', alt: 'New cover', file: await testPng(30, 30) },
      ports,
    );
    expect((await stored(a.org.id)).keys.filter((k) => k.includes(original.asset.id))).toHaveLength(
      original.asset.variants.length,
    );
  });

  it('reusing into a single slot replaces its image; an unused replaced original is purged', async () => {
    const ev = await newEvent(a.ctx());
    const first = await uploadMedia(
      a.ctx(),
      { ownerType: 'event', ownerId: ev.id, slot: 'cover', alt: 'Old cover', file: await testPng(20, 20) },
      ports,
    );
    const { asset } = await toLibrary(a.ctx());
    const r = await reuseMedia(
      a.ctx(),
      { sourceAssetId: asset.id, target: { ownerType: 'event', ownerId: ev.id, slot: 'cover' }, alt: 'New' },
      ports,
    );
    expect(r).toMatchObject({ replacedAssetId: first.asset.id, filesKept: false });
    expect((await stored(a.org.id)).keys.some((k) => k.includes(first.asset.id))).toBe(false);
    // The same image can't be placed twice in one slot.
    await expect(
      reuseMedia(
        a.ctx(),
        {
          sourceAssetId: asset.id,
          target: { ownerType: 'event', ownerId: ev.id, slot: 'cover' },
          alt: 'Again',
        },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'already_here' } });
    // Reusing a reuse points at the original.
    const g = await reuseMedia(
      a.ctx(),
      {
        sourceAssetId: r.asset.id,
        target: { ownerType: 'event', ownerId: ev.id, slot: 'gallery' },
        alt: 'G',
      },
      ports,
    );
    expect(g.asset.sourceAssetId).toBe(asset.id);
  });

  it('alt text is required for each place; logos and program photos are never decorative', async () => {
    const { asset } = await toLibrary(a.ctx());
    const ev = await newEvent(a.ctx());
    const target = { ownerType: 'event' as const, ownerId: ev.id, slot: 'gallery' as const };
    await expect(
      reuseMedia(a.ctx(), { sourceAssetId: asset.id, target, alt: '  ' }, ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const deco = await reuseMedia(
      a.ctx(),
      { sourceAssetId: asset.id, target, alt: null, decorative: true },
      ports,
    );
    expect(deco.asset).toMatchObject({ decorative: true, alt: null });
    await expect(
      reuseMedia(
        a.ctx(),
        {
          sourceAssetId: asset.id,
          target: { ownerType: 'org', ownerId: a.org.id, slot: 'logo' },
          alt: null,
          decorative: true,
        },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('the logo can come from the library (org settings only); the brand follows it', async () => {
    const { asset } = await toLibrary(a.ctx(), a, 'Org mark');
    await expect(
      reuseMedia(
        manager(),
        {
          sourceAssetId: asset.id,
          target: { ownerType: 'org', ownerId: a.org.id, slot: 'logo' },
          alt: 'Mark',
        },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const r = await reuseMedia(
      a.ctx(),
      { sourceAssetId: asset.id, target: { ownerType: 'org', ownerId: a.org.id, slot: 'logo' }, alt: 'Mark' },
      ports,
    );
    const brand = await withTenant(a.ctx(), (tx) => organizationBrandTx(tx, a.org.id));
    expect(brand?.logoPath).toContain(`/media/${a.org.id}/${r.asset.id}/`);
  });

  it('viewers can look but not reuse or delete; another org can never use the image', async () => {
    const { asset } = await toLibrary(a.ctx());
    const ev = await newEvent(a.ctx());
    const target = { ownerType: 'event' as const, ownerId: ev.id, slot: 'gallery' as const };
    await expect(
      reuseMedia(viewer(), { sourceAssetId: asset.id, target, alt: 'x' }, ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(deleteLibraryImage(viewer(), { assetId: asset.id }, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(toLibrary(viewer())).rejects.toMatchObject({ code: 'forbidden' });
    expect((await executeQuery(libraryQuery, {}, viewer(), ports)).total).toBeGreaterThan(0);

    const evB = await newEvent(b.ctx());
    await expect(
      reuseMedia(
        b.ctx(),
        {
          sourceAssetId: asset.id,
          target: { ownerType: 'event', ownerId: evB.id, slot: 'gallery' },
          alt: 'x',
        },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(
      (await executeQuery(libraryQuery, { limit: 200 }, b.ctx(), ports)).items.some(
        (i) => i.asset.id === asset.id,
      ),
    ).toBe(false);
    await expect(deleteLibraryImage(b.ctx(), { assetId: asset.id }, ports)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('a deleted speaker’s reused photo stays in the library', async () => {
    const ev = await newEvent(a.ctx());
    const speaker = await executeCommand(
      createSpeakerCommand,
      { eventId: ev.id, name: 'Ada Example' },
      a.ctx(),
      ports,
    );
    const photo = await uploadMedia(
      a.ctx(),
      { ownerType: 'library', ownerId: a.org.id, slot: 'library', alt: 'Ada', file: await testPng(40, 40) },
      ports,
    );
    const again = await reuseMedia(
      a.ctx(),
      {
        sourceAssetId: photo.asset.id,
        target: { ownerType: 'speaker', ownerId: speaker.id, slot: 'photo' },
        alt: 'Photo of Ada',
      },
      ports,
    );
    await executeCommand(deleteSpeakerCommand, { eventId: ev.id, speakerId: speaker.id }, a.ctx(), ports);
    await catchUpProgramMedia(a.org.id);
    const lib = await executeQuery(libraryQuery, { limit: 200 }, a.ctx(), ports);
    expect(lib.items.find((i) => i.asset.id === photo.asset.id)?.usedIn).toEqual([]);
    expect(lib.items.some((i) => i.asset.id === again.asset.id)).toBe(false);
    expect((await stored(a.org.id)).keys.filter((k) => k.includes(photo.asset.id))).toHaveLength(
      photo.asset.variants.length,
    );
  });

  it('storage usage: quota, usage by kind and the largest images', async () => {
    const u = await executeQuery(storageUsageQuery, { largest: 5 }, viewer(), ports);
    expect(u.limitBytes).toBe(512 * 1024 * 1024);
    expect(u.customLimit).toBe(true);
    expect(u.byKind.map((k) => k.kind)).toEqual(['events', 'venues', 'program', 'logo', 'library']);
    expect(u.byKind.reduce((s, k) => s + k.bytes, 0)).toBe(u.usedBytes);
    expect(u.largest.length).toBeLessThanOrEqual(5);
    const sizes = u.largest.map((l) => l.asset.bytes);
    expect([...sizes].sort((x, y) => y - x)).toEqual(sizes);
    expect(u.files).toBeGreaterThan(0);
    // Org B sees only its own.
    const ub = await executeQuery(storageUsageQuery, {}, b.ctx(), ports);
    expect(ub.usedBytes).toBe(await imageFileBytes(b.org.id));
  });
});
