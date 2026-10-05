import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  createEventCommand,
  type EventDto,
  transitionEventCommand,
  updateEventCommand,
} from '@yayatoh/events';
import { type Ctx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  catchUpProgramMedia,
  listMediaQuery,
  listOwnersMediaQuery,
  mediaUsageQuery,
  programImageCommand,
  publicMedia,
  publicProgramMedia,
  readVariant,
  removeMedia,
  serveTarget,
  updateMediaAltCommand,
  updateProgramImageAlt,
  uploadMedia,
  uploadProgramImage,
} from '@yayatoh/media';
import { mediaFixture, testPng } from '@yayatoh/media/testing';
import {
  createExhibitorCommand,
  createSpeakerCommand,
  createSponsorCommand,
  createSponsorTierCommand,
  deleteExhibitorCommand,
  deleteSpeakerCommand,
  deleteSponsorCommand,
  publicProgram,
} from '@yayatoh/program';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M1.4h: speaker photos and exhibitor/sponsor logos — media rows owned by program rows.
 */
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

async function assetRows(orgId: string, ownerId: string): Promise<number> {
  const [row] = await withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from media.assets where owner_id = ${ownerId}`),
  );
  return row?.n ?? 0;
}

async function variantRows(orgId: string, assetId: string): Promise<number> {
  const [row] = await withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from media.variants where asset_id = ${assetId}`),
  );
  return row?.n ?? 0;
}

async function conference(ctx: Ctx): Promise<EventDto> {
  return executeCommand(
    createEventCommand,
    {
      name: `Media Summit ${uuidv7().slice(-6)}`,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: '2030-05-01T14:00:00Z',
      endsAt: '2030-05-02T23:00:00Z',
    },
    ctx,
    ports,
  );
}

const speaker = (ev: EventDto, ctx: Ctx, name = 'Ada Lovelace') =>
  executeCommand(createSpeakerCommand, { eventId: ev.id, name }, ctx, ports);

const photo = async (ownerId: string, ctx: Ctx, over: Record<string, unknown> = {}) =>
  uploadProgramImage(
    ctx,
    'speaker',
    { ownerId, alt: 'Photo of Ada Lovelace', file: await testPng(80, 80), ...over },
    ports,
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  managerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: managerId, role: 'manager' }, a.ctx(), ports);
});
afterAll(closePools);

describe('program media: upload, replace, alt text', () => {
  it('an event editor uploads a speaker photo: variants stored, listed, counted', async () => {
    const ev = await conference(a.ctx());
    const p = await speaker(ev, a.ctx());
    const before = (await executeQuery(mediaUsageQuery, {}, a.ctx(), ports)).usedBytes;
    const { asset, replacedAssetId } = await photo(p.id, manager());
    expect(replacedAssetId).toBeNull();
    expect(asset).toMatchObject({
      ownerType: 'speaker',
      ownerId: p.id,
      slot: 'photo',
      alt: 'Photo of Ada Lovelace',
      decorative: false,
      width: 80,
      height: 80,
    });
    expect(asset.variants.map((v) => v.format).sort()).toEqual(['avif', 'jpeg', 'webp']);
    expect(await blobCount(a.org.id, asset.id)).toBe(3);
    const listed = await executeQuery(
      listOwnersMediaQuery,
      { ownerType: 'speaker', ownerIds: [p.id, uuidv7()] },
      viewer(),
      ports,
    );
    expect(listed.map((m) => m.id)).toEqual([asset.id]);
    // Quota counts program images like any other.
    expect((await executeQuery(mediaUsageQuery, {}, a.ctx(), ports)).usedBytes).toBe(before + asset.bytes);
  });

  it('a speaker has one photo: a new upload replaces it, frees its bytes and purges its files', async () => {
    const ev = await conference(a.ctx());
    const p = await speaker(ev, a.ctx());
    const first = await photo(p.id, a.ctx());
    const usage = (await executeQuery(mediaUsageQuery, {}, a.ctx(), ports)).usedBytes;
    const second = await photo(p.id, a.ctx(), { file: await testPng(90, 60, '#aa3300') });
    expect(second.replacedAssetId).toBe(first.asset.id);
    expect(await blobCount(a.org.id, first.asset.id)).toBe(0);
    expect(await variantRows(a.org.id, first.asset.id)).toBe(0);
    const now = (await executeQuery(mediaUsageQuery, {}, a.ctx(), ports)).usedBytes;
    expect(now).toBe(usage - first.asset.bytes + second.asset.bytes);
    expect(
      (await executeQuery(listMediaQuery, { ownerType: 'speaker', ownerId: p.id }, a.ctx(), ports)).map(
        (m) => m.id,
      ),
    ).toEqual([second.asset.id]);
    // The database also holds one speaker photo per speaker.
    await expect(
      withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute(sql`insert into media.assets (org_id, owner_type, owner_id, slot, source_type, width, height, alt, bytes)
          values (${a.org.id}, 'speaker', ${p.id}, 'photo', 'png', 1, 1, 'x', 1)`),
      ),
    ).rejects.toMatchObject({ cause: { constraint_name: 'assets_org_speaker_photo_key' } });
  });

  it('alt text is required and a program image is never decorative; the alt can be edited', async () => {
    const ev = await conference(a.ctx());
    const p = await speaker(ev, a.ctx());
    for (const alt of [null, '', '   '])
      await expect(photo(p.id, a.ctx(), { alt })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(photo(p.id, a.ctx(), { decorative: true, alt: null })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    const { asset } = await photo(p.id, a.ctx(), { decorative: true });
    expect(asset.decorative).toBe(false);
    const edited = await updateProgramImageAlt(
      'speaker',
      { assetId: asset.id, alt: 'Ada on stage' },
      a.ctx(),
      ports,
    );
    expect(edited.alt).toBe('Ada on stage');
    await expect(
      updateProgramImageAlt('speaker', { assetId: asset.id, alt: '' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // Families stay apart: the event-image commands can't touch a speaker photo.
    await expect(
      executeCommand(updateMediaAltCommand, { assetId: asset.id, decorative: true }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(removeMedia(a.ctx(), { assetId: asset.id }, ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(removeMedia(a.ctx(), { assetId: asset.id }, ports, 'sponsor')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('a sponsor SVG logo is stored sanitized; an exhibitor logo takes rasters', async () => {
    const ev = await conference(a.ctx());
    const tier = await executeCommand(
      createSponsorTierCommand,
      { eventId: ev.id, name: 'Gold', position: 1 },
      a.ctx(),
      ports,
    );
    const s = await executeCommand(
      createSponsorCommand,
      { eventId: ev.id, tierId: tier.id, name: 'Globex' },
      a.ctx(),
      ports,
    );
    const { asset } = await uploadProgramImage(
      a.ctx(),
      'sponsor',
      { ownerId: s.id, alt: 'Globex', file: mediaFixture('malicious/script.svg') },
      ports,
    );
    expect(asset).toMatchObject({ ownerType: 'sponsor', slot: 'logo', sourceType: 'svg' });
    const vector = asset.variants.find((v) => v.format === 'svg');
    expect(vector).toBeDefined();
    const f = fileOf(vector?.url ?? '');
    const text = new TextDecoder().decode((await readVariant(f.org, f.asset, f.file)) ?? new Uint8Array());
    expect(text).toContain('<svg');
    expect(text.toLowerCase()).not.toContain('script');
    expect(asset.variants.some((v) => v.format === 'png' && v.fallback)).toBe(true);

    const x = await executeCommand(createExhibitorCommand, { eventId: ev.id, name: 'Acme' }, a.ctx(), ports);
    const logo = await uploadProgramImage(
      a.ctx(),
      'exhibitor',
      { ownerId: x.id, alt: 'Acme', file: mediaFixture('photo-exif.jpg') },
      ports,
    );
    expect(logo.asset).toMatchObject({ ownerType: 'exhibitor', slot: 'logo', sourceType: 'jpeg' });
  });

  it('refuses unknown owners, a kind that does not match the row, and a speaker id used elsewhere', async () => {
    const ev = await conference(a.ctx());
    const p = await speaker(ev, a.ctx());
    await expect(photo(uuidv7(), a.ctx())).rejects.toMatchObject({ code: 'not_found' });
    // A speaker id is not an exhibitor.
    await expect(
      uploadProgramImage(a.ctx(), 'exhibitor', { ownerId: p.id, alt: 'x', file: await testPng() }, ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Event images can't be attached to a speaker through the event family.
    await expect(
      uploadMedia(
        a.ctx(),
        // @ts-expect-error: the event family only takes events and venues
        { ownerType: 'speaker', ownerId: p.id, slot: 'photo', alt: 'x', file: await testPng() },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('program media: permissions and entitlements', () => {
  it('a viewer can look but not upload, edit or remove', async () => {
    const ev = await conference(a.ctx());
    const p = await speaker(ev, a.ctx());
    await expect(photo(p.id, viewer())).rejects.toMatchObject({ code: 'forbidden' });
    const { asset } = await photo(p.id, a.ctx());
    await expect(
      updateProgramImageAlt('speaker', { assetId: asset.id, alt: 'Nope' }, viewer(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(removeMedia(viewer(), { assetId: asset.id }, ports, 'speaker')).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(
      await executeQuery(listOwnersMediaQuery, { ownerType: 'speaker', ownerIds: [p.id] }, viewer(), ports),
    ).toHaveLength(1);
    // Nothing written: no stray files from the refused upload. (M5.3a portal files are referenced by
    // media.portal_files, M6.1c data-subject archives by privacy.dsar_requests.)
    const [orphans] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from media.blobs b where not exists (select 1 from media.variants v where b.key = v.org_id::text || '/' || v.asset_id::text || '/' || v.file_name) and not exists (select 1 from media.portal_files f where f.storage_key = b.key) and not exists (select 1 from privacy.dsar_requests r where r.export_key = b.key) and not exists (select 1 from gallery.variants g where b.key = g.org_id::text || '/' || g.item_id::text || '/' || g.file_name)`,
      ),
    );
    expect(orphans?.n).toBe(0);
  });

  it('a revoked module refuses its images (speakers) but not the others', async () => {
    const ev = await conference(a.ctx());
    const p = await speaker(ev, a.ctx());
    const x = await executeCommand(
      createExhibitorCommand,
      { eventId: ev.id, name: 'Initech' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'speakers', effect: 'revoke', reason: 'test' },
      systemCtx(a.org.id),
      ports,
    );
    try {
      await expect(photo(p.id, a.ctx())).rejects.toMatchObject({ code: 'module_not_enabled' });
      await expect(
        uploadProgramImage(
          a.ctx(),
          'exhibitor',
          { ownerId: x.id, alt: 'Initech', file: await testPng() },
          ports,
        ),
      ).resolves.toMatchObject({ asset: { ownerType: 'exhibitor' } });
    } finally {
      await executeCommand(
        setEntitlementOverrideCommand,
        { moduleKey: 'speakers', effect: 'grant', reason: 'test' },
        systemCtx(a.org.id),
        ports,
      );
    }
  });

  it("isolation: another org can't attach to, list, change or remove this org's program images", async () => {
    const ev = await conference(a.ctx());
    const p = await speaker(ev, a.ctx());
    const { asset } = await photo(p.id, a.ctx());
    await expect(photo(p.id, b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    expect(
      await executeQuery(listOwnersMediaQuery, { ownerType: 'speaker', ownerIds: [p.id] }, b.ctx(), ports),
    ).toEqual([]);
    await expect(
      updateProgramImageAlt('speaker', { assetId: asset.id, alt: 'Mine' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(removeMedia(b.ctx(), { assetId: asset.id }, ports, 'speaker')).rejects.toMatchObject({
      code: 'not_found',
    });
    // Org B's own fixture speaker photo is invisible to org A.
    const bSpeakers = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ owner_id: string }>(sql`select owner_id from media.assets where owner_type = 'speaker'`),
    );
    expect(bSpeakers.length).toBeGreaterThan(0);
    expect(
      await executeQuery(
        listOwnersMediaQuery,
        { ownerType: 'speaker', ownerIds: bSpeakers.map((r) => r.owner_id) },
        a.ctx(),
        ports,
      ),
    ).toEqual([]);
    // A file of org A asked for under org B's id resolves to nothing.
    const f = fileOf(asset.variants[0]?.url ?? '');
    expect(await serveTarget(b.org.id, f.asset, f.file)).toBeNull();
  });
});

describe('program media: public serving follows the event', () => {
  it('private until published; public with the event; a private event only with a grant', async () => {
    const ev = await conference(a.ctx());
    const p = await speaker(ev, a.ctx());
    const { asset } = await photo(p.id, a.ctx());
    const f = fileOf(asset.variants[0]?.url ?? '');
    const target = { orgId: a.org.id, eventId: ev.id };
    // Draft: members only.
    expect(await serveTarget(f.org, f.asset, f.file)).toMatchObject({
      visibility: 'none',
      ownerType: 'speaker',
      ownerId: p.id,
      eventId: ev.id,
    });
    expect((await publicProgramMedia(a.org.id, ev.id)).size).toBe(0);

    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
    expect((await serveTarget(f.org, f.asset, f.file))?.visibility).toBe('public');
    const pub = await publicProgramMedia(a.org.id, ev.id);
    expect([...pub.keys()]).toEqual([p.id]);
    // Allowlisted: no byte counts, uploader or source type.
    expect(Object.keys(pub.get(p.id) ?? {}).sort()).toEqual(
      ['alt', 'decorative', 'height', 'id', 'ownerId', 'position', 'slot', 'variants', 'width'].sort(),
    );
    // The program itself doesn't carry media (the web composes both allowlisted payloads).
    expect((await publicProgram(target)).speakers[0]).not.toHaveProperty('photo');
    // Another event's program images never mix in.
    const other = await conference(a.ctx());
    await executeCommand(
      transitionEventCommand,
      { eventId: other.id, transition: 'publish' },
      a.ctx(),
      ports,
    );
    expect((await publicProgramMedia(a.org.id, other.id)).size).toBe(0);
    // publicMedia by owner works for program owners too.
    expect(await publicMedia('speaker', p.id)).toHaveLength(1);

    await executeCommand(updateEventCommand, { eventId: ev.id, visibility: 'private' }, a.ctx(), ports);
    expect((await serveTarget(f.org, f.asset, f.file))?.visibility).toBe('private_event');
    expect((await publicProgramMedia(a.org.id, ev.id)).size).toBe(0);
    expect((await publicProgramMedia(a.org.id, ev.id, { privateOk: true })).size).toBe(1);

    await executeCommand(updateEventCommand, { eventId: ev.id, visibility: 'public' }, a.ctx(), ports);
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'unpublish' }, a.ctx(), ports);
    expect((await serveTarget(f.org, f.asset, f.file))?.visibility).toBe('none');
    expect((await publicProgramMedia(a.org.id, ev.id)).size).toBe(0);
  });
});

describe('program media: deletion', () => {
  it('removing a photo deletes rows, variants and files; the URLs stop serving', async () => {
    const ev = await conference(a.ctx());
    const p = await speaker(ev, a.ctx());
    const { asset } = await photo(p.id, a.ctx());
    const before = (await executeQuery(mediaUsageQuery, {}, a.ctx(), ports)).usedBytes;
    await removeMedia(a.ctx(), { assetId: asset.id }, ports, 'speaker');
    expect(await assetRows(a.org.id, p.id)).toBe(0);
    expect(await variantRows(a.org.id, asset.id)).toBe(0);
    expect(await blobCount(a.org.id, asset.id)).toBe(0);
    for (const v of asset.variants) {
      const f = fileOf(v.url);
      expect(await serveTarget(f.org, f.asset, f.file)).toBeNull();
    }
    expect((await executeQuery(mediaUsageQuery, {}, a.ctx(), ports)).usedBytes).toBe(before - asset.bytes);
  });

  it('deleting a speaker, exhibitor or sponsor removes its image (rows, variants, files)', async () => {
    const ev = await conference(a.ctx());
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
    const p = await speaker(ev, a.ctx());
    const keep = await speaker(ev, a.ctx(), 'Grace Hopper');
    const x = await executeCommand(createExhibitorCommand, { eventId: ev.id, name: 'Acme' }, a.ctx(), ports);
    const tier = await executeCommand(
      createSponsorTierCommand,
      { eventId: ev.id, name: 'Silver', position: 2 },
      a.ctx(),
      ports,
    );
    const s = await executeCommand(
      createSponsorCommand,
      { eventId: ev.id, tierId: tier.id, name: 'Globex' },
      a.ctx(),
      ports,
    );
    const photoA = (await photo(p.id, a.ctx())).asset;
    const photoKeep = (await photo(keep.id, a.ctx(), { alt: 'Photo of Grace Hopper' })).asset;
    const logoX = (
      await uploadProgramImage(
        a.ctx(),
        'exhibitor',
        { ownerId: x.id, alt: 'Acme', file: await testPng() },
        ports,
      )
    ).asset;
    const logoS = (
      await uploadProgramImage(
        a.ctx(),
        'sponsor',
        { ownerId: s.id, alt: 'Globex', file: await testPng() },
        ports,
      )
    ).asset;
    const before = (await executeQuery(mediaUsageQuery, {}, a.ctx(), ports)).usedBytes;

    await executeCommand(deleteSpeakerCommand, { eventId: ev.id, speakerId: p.id }, a.ctx(), ports);
    await executeCommand(deleteExhibitorCommand, { eventId: ev.id, exhibitorId: x.id }, a.ctx(), ports);
    await executeCommand(deleteSponsorCommand, { eventId: ev.id, sponsorId: s.id }, a.ctx(), ports);
    // Before the subscriber runs the images are already private: their owners are gone.
    const f = fileOf(photoA.variants[0]?.url ?? '');
    expect((await serveTarget(f.org, f.asset, f.file))?.visibility).toBe('none');
    expect([...(await publicProgramMedia(a.org.id, ev.id)).keys()]).toEqual([keep.id]);

    // The subscriber (the worker, or the web right after the delete) removes rows and files.
    expect(await catchUpProgramMedia(a.org.id)).toBeGreaterThanOrEqual(3);
    for (const asset of [photoA, logoX, logoS]) {
      expect(await assetRows(a.org.id, asset.ownerId)).toBe(0);
      expect(await variantRows(a.org.id, asset.id)).toBe(0);
      expect(await blobCount(a.org.id, asset.id)).toBe(0);
    }
    expect((await executeQuery(mediaUsageQuery, {}, a.ctx(), ports)).usedBytes).toBe(
      before - photoA.bytes - logoX.bytes - logoS.bytes,
    );
    // The other speaker keeps their photo, and a replay changes nothing.
    expect(await blobCount(a.org.id, photoKeep.id)).toBe(3);
    expect(await catchUpProgramMedia(a.org.id)).toBe(0);
    // Org B's program images are untouched by org A's deletions.
    const [bLeft] = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from media.assets where owner_type = 'speaker'`,
      ),
    );
    expect(bLeft?.n).toBeGreaterThan(0);
  });

  it('quota: a program image over the limit is refused and leaves no files', async () => {
    const ev = await conference(a.ctx());
    const p = await speaker(ev, a.ctx());
    const { usedBytes } = await executeQuery(mediaUsageQuery, {}, a.ctx(), ports);
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`update media.quotas set bytes_limit = ${usedBytes}`),
    );
    try {
      await expect(photo(p.id, a.ctx())).rejects.toMatchObject({
        code: 'conflict',
        details: { reason: 'quota_exceeded', field: 'file' },
      });
      expect(await assetRows(a.org.id, p.id)).toBe(0);
    } finally {
      await withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute(sql`update media.quotas set bytes_limit = ${512 * 1024 * 1024}`),
      );
    }
  });

  it('every program command family is registered with its entitlement', () => {
    expect(programImageCommand.speaker.upload.entitlement).toBe('speakers');
    expect(programImageCommand.exhibitor.remove.entitlement).toBe('exhibitors');
    expect(programImageCommand.sponsor.updateAlt.entitlement).toBe('sponsors');
    for (const c of Object.values(programImageCommand))
      for (const cmd of Object.values(c)) expect(cmd.permission).toBe('events:write');
  });
});
