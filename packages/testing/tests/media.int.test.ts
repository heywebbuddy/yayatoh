import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { transitionEventCommand, updateEventCommand } from '@yayatoh/events';
import { type Ctx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  listMediaQuery,
  mediaStore,
  mediaUsageQuery,
  publicCovers,
  publicMedia,
  readVariant,
  removeMedia,
  serveTarget,
  updateLogoAltCommand,
  updateMediaAltCommand,
  uploadLogo,
  uploadMedia,
} from '@yayatoh/media';
import { mediaFixture, testPng } from '@yayatoh/media/testing';
import { addMemberCommand, organizationBrandTx } from '@yayatoh/tenancy';
import { createVenueCommand, setVenueArchivedCommand, updateVenueCommand } from '@yayatoh/venues';
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

async function blobCount(orgId: string, assetId: string): Promise<number> {
  const [row] = await withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ n: number }>(
      sql`select count(*)::int as n from media.blobs where key like ${`${orgId}/${assetId}/%`}`,
    ),
  );
  return row?.n ?? 0;
}

async function newEvent(ctx: Ctx, over: Record<string, unknown> = {}) {
  const { createEventCommand } = await import('@yayatoh/events');
  return executeCommand(
    createEventCommand,
    {
      name: `Media ${uuidv7().slice(-6)}`,
      timezone: 'America/Chicago',
      startsAt: '2027-11-01T18:00:00Z',
      endsAt: '2027-11-01T22:00:00Z',
      ...over,
    },
    ctx,
    ports,
  );
}

const cover = (eventId: string, ctx: Ctx, over: Record<string, unknown> = {}) =>
  testPng(64, 40).then((file) =>
    uploadMedia(
      ctx,
      { ownerType: 'event', ownerId: eventId, slot: 'cover', alt: 'Stage at night', file, ...over },
      ports,
    ),
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  managerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: managerId, role: 'manager' }, a.ctx(), ports);
});
afterAll(closePools);

describe('media: upload pipeline', () => {
  it('a manager uploads a cover: variants are stored, listed and counted', async () => {
    const ev = await newEvent(a.ctx());
    const { asset, replacedAssetId } = await cover(ev.id, manager());
    expect(replacedAssetId).toBeNull();
    expect(asset).toMatchObject({
      ownerType: 'event',
      slot: 'cover',
      sourceType: 'png',
      width: 64,
      height: 40,
    });
    expect(asset.variants.map((v) => v.format).sort()).toEqual(['avif', 'jpeg', 'webp']);
    for (const v of asset.variants) {
      expect(v.url).toMatch(
        new RegExp(`^/media/${a.org.id}/${asset.id}/\\d+-[0-9a-f]{32}\\.(avif|webp|jpg)$`),
      );
      const f = fileOf(v.url);
      expect((await readVariant(f.org, f.asset, f.file))?.byteLength).toBeGreaterThan(0);
    }
    expect(await blobCount(a.org.id, asset.id)).toBe(3);
    const listed = await executeQuery(
      listMediaQuery,
      { ownerType: 'event', ownerId: ev.id },
      viewer(),
      ports,
    );
    expect(listed.map((m) => m.id)).toEqual([asset.id]);
    const usage = await executeQuery(mediaUsageQuery, {}, viewer(), ports);
    expect(usage.usedBytes).toBeGreaterThanOrEqual(asset.bytes);
  });

  it('never trusts the name: a text file is refused, whatever it is called', async () => {
    const ev = await newEvent(a.ctx());
    await expect(
      uploadMedia(
        a.ctx(),
        { ownerType: 'event', ownerId: ev.id, slot: 'cover', alt: 'x', file: mediaFixture('text.png') },
        ports,
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { field: 'file', reason: 'unsupported_type' },
    });
    await expect(
      uploadMedia(
        a.ctx(),
        { ownerType: 'event', ownerId: ev.id, slot: 'cover', alt: 'x', file: mediaFixture('bomb.png') },
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'too_many_pixels' } });
    expect(
      await executeQuery(listMediaQuery, { ownerType: 'event', ownerId: ev.id }, a.ctx(), ports),
    ).toEqual([]);
  });

  it('alt text is required unless the image is decorative', async () => {
    const ev = await newEvent(a.ctx());
    await expect(cover(ev.id, a.ctx(), { alt: '   ' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(cover(ev.id, a.ctx(), { alt: null })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { issues: [expect.objectContaining({ path: 'alt' })] },
    });
    const { asset } = await cover(ev.id, a.ctx(), { alt: null, decorative: true });
    expect(asset).toMatchObject({ decorative: true, alt: null });
    const again = await executeCommand(
      updateMediaAltCommand,
      { assetId: asset.id, alt: 'A crowd dancing', decorative: false },
      a.ctx(),
      ports,
    );
    expect(again).toMatchObject({ decorative: false, alt: 'A crowd dancing' });
  });

  it('a malicious SVG is stored sanitized: the served vector has no script', async () => {
    const ev = await newEvent(a.ctx());
    const { asset } = await uploadMedia(
      a.ctx(),
      {
        ownerType: 'event',
        ownerId: ev.id,
        slot: 'gallery',
        alt: 'Logo mark',
        file: mediaFixture('malicious/script.svg'),
      },
      ports,
    );
    expect(asset.sourceType).toBe('svg');
    const vector = asset.variants.find((v) => v.format === 'svg');
    const f = fileOf(vector?.url ?? '');
    const text = new TextDecoder().decode((await readVariant(f.org, f.asset, f.file)) ?? new Uint8Array());
    expect(text).toContain('<rect');
    expect(text.toLowerCase()).not.toContain('script');
    expect(text).not.toContain('document.cookie');
  });

  it('a cover slot holds one image: a new upload replaces it and purges the old files', async () => {
    const ev = await newEvent(a.ctx());
    const first = await cover(ev.id, a.ctx());
    const second = await cover(ev.id, a.ctx(), { alt: 'New stage' });
    expect(second.replacedAssetId).toBe(first.asset.id);
    const listed = await executeQuery(listMediaQuery, { ownerType: 'event', ownerId: ev.id }, a.ctx(), ports);
    expect(listed.map((m) => [m.id, m.alt])).toEqual([[second.asset.id, 'New stage']]);
    expect(await blobCount(a.org.id, first.asset.id)).toBe(0);
    const f = fileOf(first.asset.variants[0]?.url ?? '');
    expect(await serveTarget(f.org, f.asset, f.file)).toBeNull();
  });

  it('a gallery image is replaced in place; the gallery holds at most 20', async () => {
    const ev = await newEvent(a.ctx());
    const up = (over: Record<string, unknown> = {}) =>
      testPng(20, 20).then((file) =>
        uploadMedia(
          a.ctx(),
          { ownerType: 'event', ownerId: ev.id, slot: 'gallery', alt: 'Photo', file, ...over },
          ports,
        ),
      );
    const one = await up();
    const two = await up();
    const swapped = await up({ replaceAssetId: one.asset.id, alt: 'Swapped' });
    expect(swapped.replacedAssetId).toBe(one.asset.id);
    const listed = await executeQuery(
      listMediaQuery,
      { ownerType: 'event', ownerId: ev.id, slot: 'gallery' },
      a.ctx(),
      ports,
    );
    expect(listed.map((m) => m.id)).toEqual([swapped.asset.id, two.asset.id]);
    expect(listed.map((m) => m.position)).toEqual([0, 1]);
    for (let i = listed.length; i < 20; i++) await up();
    await expect(up()).rejects.toMatchObject({ code: 'conflict', details: { reason: 'slot_full' } });
    // Replacing still works when the slot is full.
    await expect(up({ replaceAssetId: two.asset.id })).resolves.toMatchObject({
      replacedAssetId: two.asset.id,
    });
  });

  it('refuses a slot that does not belong to the owner, and unknown owners', async () => {
    const ev = await newEvent(a.ctx());
    await expect(
      uploadMedia(
        a.ctx(),
        { ownerType: 'event', ownerId: ev.id, slot: 'photo', alt: 'x', file: await testPng() },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'slot' } });
    await expect(cover(uuidv7(), a.ctx())).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('media: permissions', () => {
  it('a viewer can look but not upload, change or remove', async () => {
    const ev = await newEvent(a.ctx());
    const { asset } = await cover(ev.id, a.ctx());
    await expect(cover(ev.id, viewer())).rejects.toMatchObject({ code: 'forbidden' });
    await expect(uploadLogo(viewer(), { alt: 'Logo', file: await testPng() }, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      executeCommand(updateMediaAltCommand, { assetId: asset.id, alt: 'x' }, viewer(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(removeMedia(viewer(), { assetId: asset.id }, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(
      await executeQuery(listMediaQuery, { ownerType: 'event', ownerId: ev.id }, viewer(), ports),
    ).toHaveLength(1);
    expect(await blobCount(a.org.id, asset.id)).toBe(3);
  });

  it('a manager edits event media but not the org logo (org settings)', async () => {
    await expect(uploadLogo(manager(), { alt: 'Logo', file: await testPng() }, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('logo commands only touch the logo, content commands never touch it', async () => {
    const [logo] = await executeQuery(
      listMediaQuery,
      { ownerType: 'org', ownerId: a.org.id },
      a.ctx(),
      ports,
    );
    expect(logo).toBeDefined();
    await expect(removeMedia(a.ctx(), { assetId: logo?.id ?? '' }, ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    const ev = await newEvent(a.ctx());
    const { asset } = await cover(ev.id, a.ctx());
    await expect(removeMedia(a.ctx(), { assetId: asset.id }, ports, 'logo')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('media: org logo', () => {
  it('the logo sets the org brand (email-safe fallback path and alt); removing clears it', async () => {
    const { asset } = await uploadLogo(
      a.ctx(),
      { alt: 'Alpha Events', file: mediaFixture('logo.svg') },
      ports,
    );
    const fallback = asset.variants.find((v) => v.fallback);
    expect(fallback?.format).toBe('png');
    let brand = await withTenant(a.ctx(), (tx) => organizationBrandTx(tx, a.org.id));
    expect(brand).toMatchObject({ logoPath: fallback?.url, logoAlt: 'Alpha Events' });
    await executeCommand(
      updateLogoAltCommand,
      { assetId: asset.id, alt: 'Alpha Events logo' },
      a.ctx(),
      ports,
    );
    brand = await withTenant(a.ctx(), (tx) => organizationBrandTx(tx, a.org.id));
    expect(brand?.logoAlt).toBe('Alpha Events logo');
    await expect(
      executeCommand(
        updateLogoAltCommand,
        { assetId: asset.id, alt: null, decorative: true },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // Public: the org is active.
    expect((await publicMedia('org', a.org.id)).map((m) => m.id)).toEqual([asset.id]);
    await removeMedia(a.ctx(), { assetId: asset.id }, ports, 'logo');
    brand = await withTenant(a.ctx(), (tx) => organizationBrandTx(tx, a.org.id));
    expect(brand).toMatchObject({ logoPath: null, logoAlt: null });
    expect(await blobCount(a.org.id, asset.id)).toBe(0);
    expect(await publicMedia('org', a.org.id)).toEqual([]);
  });
});

describe('media: serving permissions', () => {
  it('event images are public only while the event has a public page', async () => {
    const ev = await newEvent(a.ctx());
    const { asset } = await cover(ev.id, a.ctx());
    const f = fileOf(asset.variants[0]?.url ?? '');
    expect((await serveTarget(f.org, f.asset, f.file))?.visibility).toBe('none');
    expect(await publicMedia('event', ev.id)).toEqual([]);
    expect((await publicCovers([ev.slug])).size).toBe(0);

    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
    expect((await serveTarget(f.org, f.asset, f.file))?.visibility).toBe('public');
    const pub = await publicMedia('event', ev.id);
    expect(pub).toHaveLength(1);
    // Allowlisted: no byte counts, uploader or source type leave through the public DTO.
    expect(Object.keys(pub[0] ?? {}).sort()).toEqual(
      ['alt', 'decorative', 'height', 'id', 'ownerId', 'position', 'slot', 'variants', 'width'].sort(),
    );
    expect((await publicCovers([ev.slug, 'no-such-event'])).get(ev.slug)?.id).toBe(asset.id);

    await executeCommand(updateEventCommand, { eventId: ev.id, visibility: 'private' }, a.ctx(), ports);
    expect((await serveTarget(f.org, f.asset, f.file))?.visibility).toBe('private_event');
    expect(await publicMedia('event', ev.id)).toEqual([]);
    expect(await publicMedia('event', ev.id, { privateOk: true })).toHaveLength(1);
    expect((await publicCovers([ev.slug])).size).toBe(0);

    await executeCommand(updateEventCommand, { eventId: ev.id, visibility: 'unlisted' }, a.ctx(), ports);
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'unpublish' }, a.ctx(), ports);
    expect((await serveTarget(f.org, f.asset, f.file))?.visibility).toBe('none');
  });

  it('venue photos are public only for listed, live venues', async () => {
    const venue = await executeCommand(
      createVenueCommand,
      { name: `Hall ${uuidv7().slice(-6)}`, country: 'US', timezone: 'America/Chicago' },
      a.ctx(),
      ports,
    );
    const { asset } = await uploadMedia(
      a.ctx(),
      { ownerType: 'venue', ownerId: venue.id, slot: 'photo', alt: 'The main hall', file: await testPng() },
      ports,
    );
    const f = fileOf(asset.variants[0]?.url ?? '');
    expect((await serveTarget(f.org, f.asset, f.file))?.visibility).toBe('none');
    await executeCommand(updateVenueCommand, { venueId: venue.id, directoryListed: true }, a.ctx(), ports);
    expect((await serveTarget(f.org, f.asset, f.file))?.visibility).toBe('public');
    expect(await publicMedia('venue', venue.id)).toHaveLength(1);
    await executeCommand(setVenueArchivedCommand, { venueId: venue.id, archived: true }, a.ctx(), ports);
    expect((await serveTarget(f.org, f.asset, f.file))?.visibility).toBe('none');
    expect(await publicMedia('venue', venue.id)).toEqual([]);
  });

  it('unknown files and mismatched orgs resolve to nothing', async () => {
    const [logo] = await executeQuery(
      listMediaQuery,
      { ownerType: 'org', ownerId: b.org.id },
      b.ctx(),
      ports,
    );
    const f = fileOf(logo?.variants[0]?.url ?? '');
    expect(await serveTarget(f.org, f.asset, f.file)).not.toBeNull();
    expect(await serveTarget(a.org.id, f.asset, f.file)).toBeNull();
    expect(await serveTarget(f.org, f.asset, `9-${'0'.repeat(32)}.png`)).toBeNull();
    expect(await readVariant(a.org.id, f.asset, f.file)).toBeNull();
  });
});

describe('media: isolation', () => {
  it("another org can't see, change, remove or attach to this org's images", async () => {
    const ev = await newEvent(a.ctx());
    const { asset } = await cover(ev.id, a.ctx());
    expect(
      await executeQuery(listMediaQuery, { ownerType: 'event', ownerId: ev.id }, b.ctx(), ports),
    ).toEqual([]);
    await expect(
      executeCommand(updateMediaAltCommand, { assetId: asset.id, alt: 'mine now' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(removeMedia(b.ctx(), { assetId: asset.id }, ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    // Org B can't attach an image to org A's event (the owner is looked up under B's RLS).
    await expect(cover(ev.id, b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    // A viewer of org B is not a member of org A.
    await expect(
      executeQuery(
        listMediaQuery,
        { ownerType: 'event', ownerId: ev.id },
        userCtx(b.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await blobCount(a.org.id, asset.id)).toBe(3);
    expect(await blobCount(b.org.id, asset.id)).toBe(0);
  });

  it("the store refuses keys outside the caller's org prefix", async () => {
    const [logo] = await executeQuery(
      listMediaQuery,
      { ownerType: 'org', ownerId: a.org.id },
      a.ctx(),
      ports,
    );
    const f = fileOf(logo?.variants[0]?.url ?? '');
    await expect(mediaStore().get(b.org.id, `${a.org.id}/${f.asset}/${f.file}`)).rejects.toThrow(
      /org prefix/,
    );
    await expect(
      mediaStore().put(b.org.id, `${a.org.id}/${f.asset}/${f.file}`, new Uint8Array(1), 'image/png'),
    ).rejects.toThrow(/org prefix/);
    await expect(mediaStore().get(a.org.id, `${a.org.id}/${f.asset}/../../x`)).rejects.toThrow(/org prefix/);
  });
});

describe('media: quota and deletion', () => {
  it('uploads stop at the org quota; replacing frees the old bytes first', async () => {
    const ev = await newEvent(a.ctx());
    const first = await cover(ev.id, a.ctx());
    const { usedBytes } = await executeQuery(mediaUsageQuery, {}, a.ctx(), ports);
    // Room for exactly what is stored now.
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`update media.quotas set bytes_limit = ${usedBytes}`),
    );
    try {
      expect(await executeQuery(mediaUsageQuery, {}, a.ctx(), ports)).toEqual({
        usedBytes,
        limitBytes: usedBytes,
      });
      await expect(
        uploadMedia(
          a.ctx(),
          { ownerType: 'event', ownerId: ev.id, slot: 'gallery', alt: 'More', file: await testPng(30, 30) },
          ports,
        ),
      ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'quota_exceeded' } });
      // The failed upload left no files behind. (M5.3a portal files are referenced by media.portal_files,
      // M6.1c data-subject archives by privacy.dsar_requests, M4.5b gallery photos by gallery.variants.)
      const [orphans] = await withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute<{ n: number }>(
          sql`select count(*)::int as n from media.blobs b where not exists (select 1 from media.variants v where b.key = v.org_id::text || '/' || v.asset_id::text || '/' || v.file_name) and not exists (select 1 from media.portal_files f where f.storage_key = b.key) and not exists (select 1 from privacy.dsar_requests r where r.export_key = b.key) and not exists (select 1 from gallery.variants g where b.key = g.org_id::text || '/' || g.item_id::text || '/' || g.file_name)`,
        ),
      );
      expect(orphans?.n).toBe(0);
      // The same image again replaces the cover: its bytes don't count twice.
      await expect(cover(ev.id, a.ctx())).resolves.toMatchObject({ replacedAssetId: first.asset.id });
      // Org B's quota is untouched.
      expect((await executeQuery(mediaUsageQuery, {}, b.ctx(), ports)).limitBytes).toBe(512 * 1024 * 1024);
    } finally {
      await withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute(sql`update media.quotas set bytes_limit = ${512 * 1024 * 1024}`),
      );
    }
  });

  it('removing an image deletes its rows, its variants and its files', async () => {
    const ev = await newEvent(a.ctx());
    const { asset } = await cover(ev.id, a.ctx());
    const before = (await executeQuery(mediaUsageQuery, {}, a.ctx(), ports)).usedBytes;
    await removeMedia(a.ctx(), { assetId: asset.id }, ports);
    expect(
      await executeQuery(listMediaQuery, { ownerType: 'event', ownerId: ev.id }, a.ctx(), ports),
    ).toEqual([]);
    const [variantsLeft] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from media.variants where asset_id = ${asset.id}`,
      ),
    );
    expect(variantsLeft?.n).toBe(0);
    expect(await blobCount(a.org.id, asset.id)).toBe(0);
    for (const v of asset.variants) {
      const f = fileOf(v.url);
      expect(await serveTarget(f.org, f.asset, f.file)).toBeNull();
      expect(await readVariant(f.org, f.asset, f.file)).toBeNull();
    }
    expect((await executeQuery(mediaUsageQuery, {}, a.ctx(), ports)).usedBytes).toBe(before - asset.bytes);
    await expect(removeMedia(a.ctx(), { assetId: asset.id }, ports)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
