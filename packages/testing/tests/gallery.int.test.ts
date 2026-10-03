import { type TenantTx, withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import {
  addGalleryVideoCommand,
  addGuestGalleryVideoCommand,
  completeGalleryUploadCommand,
  GALLERY_LIMITS,
  hostGalleryQuery,
  hostSlidesQuery,
  moderateGalleryCommand,
  publicGalleryQuery,
  publicSlidesQuery,
  purgeExpiredGalleryUploads,
  readGalleryFile,
  removeGalleryItemCommand,
  removeOwnGalleryItemCommand,
  requestGalleryUploadCommand,
  requestGuestGalleryUploadCommand,
  runGalleryCommand,
  saveGallerySettingsCommand,
} from '@yayatoh/gallery';
import { fakeHeic } from '@yayatoh/gallery/testing';
import { setGuestSitePasswordCommand } from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { mediaStore } from '@yayatoh/media';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  enableGallery,
  GUEST_SITE_PASSWORD,
  guestGalleryPhoto,
  guestSiteAccess,
  guestSiteScenario,
  hostGalleryPhoto,
  type OrgFixture,
  ports,
  putToSlot,
  systemCtx,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

/**
 * M4.5b: the event gallery. Acceptance: **the per-event storage cap is enforced** — when a slot is
 * handed out (the declared size, exactly-at-the-cap allowed, one byte over refused, concurrent
 * slots serialized) and again when the photo is processed (the stored size). Plus the per-guest
 * quota, the moderation queue (P4-6), HEIC through its port, video links (P4-5), the guest gate,
 * signed file URLs, isolation, permissions, impersonation and the freeze.
 */

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
});
afterAll(async () => {
  await admin`select platform.set_ops_flag('read_only_freeze', null::jsonb, 'test', 'test:gallery')`;
  await admin.end();
  await closePools();
});

const visitor = (orgId: string): Ctx => createCtx({ orgId });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = (err.details as { reason?: string } | undefined)?.reason;
    return `${err.code}${reason ? `:${reason}` : ''}`;
  }
}

const image = async (w: number, h: number, format: 'jpeg' | 'png' = 'jpeg', noise = false) =>
  new Uint8Array(
    await sharp({
      create: {
        width: w,
        height: h,
        channels: 3,
        background: { r: 180, g: 90, b: 60 },
        ...(noise ? { noise: { type: 'gaussian' as const, mean: 128, sigma: 50 } } : {}),
      },
    })
      [format]()
      .toBuffer(),
  );

/** A wedding with a published guest site, the gallery on, and a guest's access proof. */
async function gallery(f: OrgFixture, opts: Parameters<typeof enableGallery>[2] = {}) {
  const s = await guestSiteScenario(f.org.id, { ctx: f.ctx() });
  await enableGallery(f.ctx(), s.eventId, opts);
  const access = await guestSiteAccess(f.org.id, s.eventId, GUEST_SITE_PASSWORD);
  return { ...s, access };
}

const host = (f: OrgFixture, eventId: string) => executeQuery(hostGalleryQuery, { eventId }, f.ctx(), ports);

const messages = (orgId: string, eventId: string) =>
  withTenant(systemCtx(orgId), (tx: TenantTx) =>
    tx.execute<{ event: string; data: { itemId: string; state: string } }>(
      sql`select event, data from platform.realtime_messages where channel = ${`org:${orgId}:event:${eventId}:gallery`} order by seq`,
    ),
  );

describe('uploads and moderation (P4-6)', () => {
  it('host photos publish at once; guest photos wait for approval; approve publishes, reject deletes the files', async () => {
    const g = await gallery(a);
    const hostPhoto = await hostGalleryPhoto(a.ctx(), g.eventId, await image(800, 600), 'First dance');
    expect(hostPhoto).toMatchObject({ status: 'published', reason: null });

    const one = await guestGalleryPhoto(a.org.id, { ...g, name: 'Marta' }, await image(640, 480), 'Cake!');
    expect(one.status).toBe('pending');
    const two = await guestGalleryPhoto(a.org.id, { ...g, uploader: one.uploader }, await image(320, 240));
    expect(two.status).toBe('pending');

    let view = await host(a, g.eventId);
    expect(view.pending.map((i) => i.id)).toEqual([one.itemId, two.itemId]);
    expect(view.pending[0]).toMatchObject({
      by: 'Marta',
      byHost: false,
      caption: 'Cake!',
      sourceType: 'jpeg',
    });
    expect(view.published.map((i) => i.id)).toEqual([hostPhoto.itemId]);
    expect(view.published[0]).toMatchObject({ byHost: true, by: null, caption: 'First dance' });
    expect(view.usage).toMatchObject({ pending: 2, published: 1, items: 3 });

    // Guests see only published items, plus their own (with their state).
    let pub = await executeQuery(
      publicGalleryQuery,
      { eventId: g.eventId, access: g.access, uploader: one.uploader },
      visitor(a.org.id),
      ports,
    );
    if (pub.state !== 'open') throw new Error('expected open');
    expect(pub.published.map((i) => i.id)).toEqual([hostPhoto.itemId]);
    expect(pub.mine.map((i) => [i.id, i.status])).toEqual([
      [two.itemId, 'pending'],
      [one.itemId, 'pending'],
    ]);
    expect(pub.myName).toBe('Marta');
    // The allowlist: no storage key, upload id or user id ever leaves.
    expect(JSON.stringify(pub)).not.toMatch(/upload_?[kK]ey|uploadId|userId|u-[0-9a-f]{32}/);

    const approved = await runGalleryCommand(
      moderateGalleryCommand,
      { eventId: g.eventId, itemIds: [one.itemId], decision: 'approve' },
      a.ctx(),
      ports,
    );
    expect(approved.changed).toBe(1);
    const rejectedFiles = (await host(a, g.eventId)).pending.find((i) => i.id === two.itemId)?.files ?? [];
    expect(rejectedFiles.length).toBeGreaterThan(0);
    const rejected = await runGalleryCommand(
      moderateGalleryCommand,
      { eventId: g.eventId, itemIds: [two.itemId], decision: 'reject' },
      a.ctx(),
      ports,
    );
    expect(rejected).toMatchObject({ changed: 1, purge: [two.itemId] });
    // The rejected photo's files are gone from storage.
    const first = rejectedFiles[0];
    if (!first) throw new Error('expected a file');
    const fileName = first.url.split('?')[0]?.split('/').pop() ?? '';
    expect(await mediaStore().get(a.org.id, `${a.org.id}/${two.itemId}/${fileName}`)).toBeNull();

    view = await host(a, g.eventId);
    expect(view.pending).toHaveLength(0);
    expect(view.published.map((i) => i.id)).toEqual([one.itemId, hostPhoto.itemId]);
    pub = await executeQuery(
      publicGalleryQuery,
      { eventId: g.eventId, access: g.access, uploader: null },
      visitor(a.org.id),
      ports,
    );
    if (pub.state !== 'open') throw new Error('expected open');
    expect(pub.mine).toEqual([]);

    // The slideshow's feed: ids and states only, for each publication.
    const live = await messages(a.org.id, g.eventId);
    expect(live.map((m) => [m.event, m.data.itemId, m.data.state])).toEqual([
      ['item', hostPhoto.itemId, 'published'],
      ['item', one.itemId, 'published'],
    ]);
    expect(Object.keys(live[0]?.data ?? {}).sort()).toEqual(['at', 'itemId', 'state']);
  });

  it('auto-publish: guest photos appear at once and reach the slideshow', async () => {
    const g = await gallery(a, { moderation: 'auto' });
    const p = await guestGalleryPhoto(a.org.id, { ...g, name: 'Ines' }, await image(400, 300));
    expect(p.status).toBe('published');
    const slides = await executeQuery(
      publicSlidesQuery,
      { eventId: g.eventId, access: g.access },
      visitor(a.org.id),
      ports,
    );
    expect(slides.photos.map((x) => x.id)).toEqual([p.itemId]);
    expect((await executeQuery(hostSlidesQuery, { eventId: g.eventId }, a.ctx(), ports)).photos).toHaveLength(
      1,
    );
  });

  it('completing twice answers the same; a slot without bytes is not yet complete', async () => {
    const g = await gallery(a);
    const bytes = await image(300, 200);
    const slot = await executeCommand(
      requestGalleryUploadCommand,
      { eventId: g.eventId, bytes: bytes.byteLength, caption: null },
      a.ctx(),
      ports,
    );
    expect(
      await codeOf(
        executeCommand(
          completeGalleryUploadCommand,
          { eventId: g.eventId, itemId: slot.itemId },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('invalid_state:upload_missing');
    // The direct-upload stand-in refuses any other size than the signed one.
    expect(await putToSlot(slot.url, bytes.subarray(1))).toBe(false);
    expect(await putToSlot(slot.url, bytes)).toBe(true);
    const done = await runGalleryCommand(
      completeGalleryUploadCommand,
      { eventId: g.eventId, itemId: slot.itemId },
      a.ctx(),
      ports,
    );
    expect(done.status).toBe('published');
    const again = await runGalleryCommand(
      completeGalleryUploadCommand,
      { eventId: g.eventId, itemId: slot.itemId },
      a.ctx(),
      ports,
    );
    expect(again).toMatchObject({ status: 'published', purge: [] });
  });
});

describe('what a photo may be (HEIC accepted, never SVG)', () => {
  it('HEIC is decoded through its port and re-encoded like any photo', async () => {
    const g = await gallery(a, { moderation: 'auto' });
    const r = await hostGalleryPhoto(a.ctx(), g.eventId, fakeHeic(await image(1200, 900)));
    expect(r).toMatchObject({ status: 'published', reason: null });
    const item = (await host(a, g.eventId)).published.find((i) => i.id === r.itemId);
    expect(item).toMatchObject({ sourceType: 'heic', width: 1200, height: 900 });
    expect(item?.files.map((f) => f.format)).toEqual(expect.arrayContaining(['avif', 'webp', 'jpeg']));
  });

  it('refuses an undecodable HEIC, an SVG, random bytes and a size mismatch, deleting the item', async () => {
    const g = await gallery(a);
    const header = fakeHeic(new Uint8Array(0)).subarray(0, 24);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    const junk = new Uint8Array(2048).map((_, i) => (i * 37) % 251);
    const cases: [Uint8Array, string][] = [
      [header, 'heic_unsupported'],
      [svg, 'unsupported_type'],
      [junk, 'unsupported_type'],
    ];
    for (const [bytes, reason] of cases) {
      const r = await hostGalleryPhoto(a.ctx(), g.eventId, bytes);
      expect(r).toMatchObject({ status: 'refused', reason });
    }
    // Bytes that changed after the slot was signed (another size than declared).
    const bytes = await image(200, 200);
    const slot = await executeCommand(
      requestGalleryUploadCommand,
      { eventId: g.eventId, bytes: bytes.byteLength, caption: null },
      a.ctx(),
      ports,
    );
    const key = await withTenant(systemCtx(a.org.id), async (tx) => {
      const rows = await tx.execute<{ upload_key: string }>(
        sql`select upload_key from gallery.items where id = ${slot.itemId}`,
      );
      return rows[0]?.upload_key ?? '';
    });
    await mediaStore().put(a.org.id, key, bytes.subarray(10), 'application/octet-stream');
    const r = await runGalleryCommand(
      completeGalleryUploadCommand,
      { eventId: g.eventId, itemId: slot.itemId },
      a.ctx(),
      ports,
    );
    expect(r).toMatchObject({ status: 'refused', reason: 'size_mismatch' });
    expect(await mediaStore().get(a.org.id, key)).toBeNull();
    const view = await host(a, g.eventId);
    expect(view.usage.items).toBe(0);
  });

  it('a slot is refused above the largest upload', async () => {
    const g = await gallery(a);
    expect(
      await codeOf(
        executeCommand(
          requestGalleryUploadCommand,
          { eventId: g.eventId, bytes: GALLERY_LIMITS.maxUploadBytes + 1, caption: null },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('validation_failed:too_large');
  });
});

describe('the per-event storage cap is enforced (acceptance)', () => {
  it('when a slot is handed out: exactly at the cap is allowed, one byte over is refused, for guests and hosts', async () => {
    const g = await gallery(a, { capBytes: 10_000 });
    const slot = await executeCommand(
      requestGalleryUploadCommand,
      { eventId: g.eventId, bytes: 6_000, caption: null },
      a.ctx(),
      ports,
    );
    // 6,000 reserved: 4,001 more is one byte over, 4,000 exactly fills the cap.
    expect(
      await codeOf(
        executeCommand(
          requestGuestGalleryUploadCommand,
          { eventId: g.eventId, access: g.access, uploader: null, name: 'Over', bytes: 4_001, caption: null },
          visitor(a.org.id),
          ports,
        ),
      ),
    ).toBe('conflict:event_cap');
    expect(
      await codeOf(
        executeCommand(
          requestGalleryUploadCommand,
          { eventId: g.eventId, bytes: 4_001, caption: null },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('conflict:event_cap');
    const exact = await executeCommand(
      requestGuestGalleryUploadCommand,
      { eventId: g.eventId, access: g.access, uploader: null, name: 'Exact', bytes: 4_000, caption: null },
      visitor(a.org.id),
      ports,
    );
    expect(exact.itemId).toBeTruthy();
    expect((await host(a, g.eventId)).usage).toMatchObject({ usedBytes: 10_000, capBytes: 10_000 });
    expect(
      await codeOf(
        executeCommand(
          requestGalleryUploadCommand,
          { eventId: g.eventId, bytes: 1, caption: null },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('conflict:event_cap');
    // Video links take no storage but count as items; the cap does not refuse them.
    expect(slot.itemId).toBeTruthy();
    const pub = await executeQuery(
      publicGalleryQuery,
      { eventId: g.eventId, access: g.access, uploader: exact.uploader },
      visitor(a.org.id),
      ports,
    );
    expect(pub).toMatchObject({ state: 'open', eventFull: true });
  });

  it('when the photo is processed: its stored size is checked again and an over-cap photo is refused and deleted', async () => {
    const g = await gallery(a);
    // A low-quality noisy JPEG is small; its re-encoded variants together are larger.
    const bytes = new Uint8Array(
      await sharp({
        create: {
          width: 400,
          height: 300,
          channels: 3,
          background: { r: 128, g: 128, b: 128 },
          noise: { type: 'gaussian', mean: 128, sigma: 60 },
        },
      })
        .jpeg({ quality: 20 })
        .toBuffer(),
    );
    const first = await hostGalleryPhoto(a.ctx(), g.eventId, bytes);
    expect(first.status).toBe('published');
    const used = (await host(a, g.eventId)).usage.usedBytes;
    expect(used).toBeGreaterThan(bytes.byteLength);
    // Room for the declared size only.
    await enableGallery(a.ctx(), g.eventId, { capBytes: used + bytes.byteLength });
    const r = await hostGalleryPhoto(a.ctx(), g.eventId, bytes);
    expect(r).toMatchObject({ status: 'refused', reason: 'event_cap' });
    const view = await host(a, g.eventId);
    expect(view.usage).toMatchObject({ usedBytes: used, items: 1 });
    expect(view.usage.usedBytes).toBeLessThanOrEqual(view.usage.capBytes);
    const rows = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(
        sql`select 1 from gallery.items where id = ${r.itemId} union all select 1 from gallery.variants where item_id = ${r.itemId}`,
      ),
    );
    expect(rows).toHaveLength(0);
  });

  it('concurrent slots are serialized under the event lock: the cap is never overrun', async () => {
    const g = await gallery(a, { capBytes: 50_000 });
    const tries = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        codeOf(
          executeCommand(
            requestGuestGalleryUploadCommand,
            {
              eventId: g.eventId,
              access: g.access,
              uploader: null,
              name: `Guest ${i}`,
              bytes: 20_000,
              caption: null,
            },
            visitor(a.org.id),
            ports,
          ),
        ),
      ),
    );
    expect(tries.filter((t) => t === 'ok')).toHaveLength(2);
    expect(tries.filter((t) => t === 'conflict:event_cap')).toHaveLength(6);
    expect((await host(a, g.eventId)).usage.usedBytes).toBe(40_000);
  });

  it('an expired slot stops counting and is swept with its bytes; a lowered cap blocks new uploads; a host cannot raise it', async () => {
    const g = await gallery(a, { capBytes: 10_000 });
    const bytes = await image(100, 100);
    const slot = await executeCommand(
      requestGalleryUploadCommand,
      { eventId: g.eventId, bytes: bytes.byteLength, caption: null },
      a.ctx(),
      ports,
    );
    await putToSlot(slot.url, bytes);
    const later = new Date(Date.now() + GALLERY_LIMITS.uploadSlotSeconds * 1000 + 60_000);
    const view = await executeQuery(hostGalleryQuery, { eventId: g.eventId }, a.ctx({ now: later }), ports);
    expect(view.usage.usedBytes).toBe(0);
    expect(
      await runGalleryCommand(
        completeGalleryUploadCommand,
        { eventId: g.eventId, itemId: slot.itemId },
        a.ctx({ now: later }),
        ports,
      ),
    ).toMatchObject({ status: 'refused', reason: 'expired' });

    const stale = await executeCommand(
      requestGalleryUploadCommand,
      { eventId: g.eventId, bytes: bytes.byteLength, caption: null },
      a.ctx(),
      ports,
    );
    await putToSlot(stale.url, bytes);
    expect(await purgeExpiredGalleryUploads(a.org.id, g.eventId, later)).toBe(1);

    const settings = await executeCommand(
      saveGallerySettingsCommand,
      {
        eventId: g.eventId,
        enabled: true,
        moderation: 'hold',
        capBytes: 10 * 1024 ** 4,
        guestQuotaBytes: 10 * 1024 ** 4,
        guestQuotaItems: 10_000,
      },
      a.ctx(),
      ports,
    );
    expect(settings).toMatchObject({
      capBytes: GALLERY_LIMITS.eventCapBytes,
      guestQuotaBytes: GALLERY_LIMITS.guestQuotaBytes,
      guestQuotaItems: GALLERY_LIMITS.guestQuotaItems,
    });
    await hostGalleryPhoto(a.ctx(), g.eventId, bytes);
    await enableGallery(a.ctx(), g.eventId, { capBytes: 1 });
    expect(
      await codeOf(
        executeCommand(
          requestGalleryUploadCommand,
          { eventId: g.eventId, bytes: 1, caption: null },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('conflict:event_cap');
  });
});

describe('the per-guest quota', () => {
  it('counts items and bytes per guest; other guests and hosts are not limited by it', async () => {
    const g = await gallery(a, { guestQuotaItems: 2, guestQuotaBytes: 30_000 });
    const req = (uploader: string | null, name: string | null, bytes: number) =>
      executeCommand(
        requestGuestGalleryUploadCommand,
        { eventId: g.eventId, access: g.access, uploader, name, bytes, caption: null },
        visitor(a.org.id),
        ports,
      );
    const s1 = await req(null, 'Pia', 10_000);
    const s2 = await req(s1.uploader, null, 10_000);
    expect(s2.uploader).toBe(s1.uploader);
    expect(await codeOf(req(s1.uploader, null, 10))).toBe('conflict:guest_items');
    const other = await req(null, 'Noor', 25_000);
    expect(await codeOf(req(other.uploader, null, 5_001))).toBe('conflict:guest_bytes');
    expect(await codeOf(req(other.uploader, null, 5_000))).toBe('ok');
    // Hosts have no personal quota.
    for (let i = 0; i < 3; i++)
      await executeCommand(
        requestGalleryUploadCommand,
        { eventId: g.eventId, bytes: 20_000, caption: null },
        a.ctx(),
        ports,
      );
    // Video links count as items too.
    expect(
      await codeOf(
        executeCommand(
          addGuestGalleryVideoCommand,
          {
            eventId: g.eventId,
            access: g.access,
            uploader: s1.uploader,
            name: null,
            url: 'https://youtu.be/dQw4w9WgXcQ',
            caption: null,
          },
          visitor(a.org.id),
          ports,
        ),
      ),
    ).toBe('conflict:guest_items');
  });

  it('a first upload needs a name; another event’s uploader cookie is not this event’s', async () => {
    const g = await gallery(a);
    const g2 = await gallery(a);
    const req = (eventId: string, access: string, uploader: string | null, name: string | null) =>
      executeCommand(
        requestGuestGalleryUploadCommand,
        { eventId, access, uploader, name, bytes: 100, caption: null },
        visitor(a.org.id),
        ports,
      );
    expect(await codeOf(req(g.eventId, g.access, null, '  '))).toBe('validation_failed:required');
    const s = await req(g.eventId, g.access, null, 'Rui');
    expect(await codeOf(req(g2.eventId, g2.access, s.uploader, null))).toBe('validation_failed:required');
    expect(await codeOf(req(g.eventId, g.access, `${s.uploader}x`, null))).toBe('validation_failed:required');
  });
});

describe('video links only (P4-5)', () => {
  it('YouTube and Vimeo links become canonical links; anything else is refused', async () => {
    const g = await gallery(a);
    const yt = await executeCommand(
      addGalleryVideoCommand,
      {
        eventId: g.eventId,
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&utm_source=x',
        caption: 'Toast',
      },
      a.ctx(),
      ports,
    );
    expect(yt.status).toBe('published');
    const vm = await executeCommand(
      addGuestGalleryVideoCommand,
      {
        eventId: g.eventId,
        access: g.access,
        uploader: null,
        name: 'Ana',
        url: 'vimeo.com/76979871',
        caption: null,
      },
      visitor(a.org.id),
      ports,
    );
    expect(vm.status).toBe('pending');
    const view = await host(a, g.eventId);
    expect(view.published[0]?.video).toEqual({
      provider: 'youtube',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    expect(view.pending[0]?.video).toEqual({ provider: 'vimeo', url: 'https://vimeo.com/76979871' });
    for (const url of [
      'https://evil.example/watch?v=dQw4w9WgXcQ',
      'javascript:alert(1)',
      'https://youtube.com/watch?v=short',
    ]) {
      expect(
        await codeOf(
          executeCommand(addGalleryVideoCommand, { eventId: g.eventId, url, caption: null }, a.ctx(), ports),
        ),
      ).toBe('validation_failed:video_link');
    }
    expect(view.videoUploads).toBe(false);
  });
});

describe('the guest gate', () => {
  it('locked without the password, closed while off, not found while the site is unpublished; a new password locks guests out', async () => {
    const s = await guestSiteScenario(a.org.id, { ctx: a.ctx() });
    const access = await guestSiteAccess(a.org.id, s.eventId, GUEST_SITE_PASSWORD);
    const q = (acc: string | null) =>
      executeQuery(
        publicGalleryQuery,
        { eventId: s.eventId, access: acc, uploader: null },
        visitor(a.org.id),
        ports,
      );
    expect(await q(access)).toMatchObject({ state: 'closed' });
    await enableGallery(a.ctx(), s.eventId);
    expect(await q(null)).toEqual({ state: 'locked', eventName: expect.any(String) });
    expect(await q('forged')).toMatchObject({ state: 'locked' });
    expect(await q(access)).toMatchObject({ state: 'open' });
    const upload = (acc: string | null) =>
      executeCommand(
        requestGuestGalleryUploadCommand,
        { eventId: s.eventId, access: acc, uploader: null, name: 'X', bytes: 10, caption: null },
        visitor(a.org.id),
        ports,
      );
    expect(await codeOf(upload(null))).toBe('forbidden:locked');
    await executeCommand(
      setGuestSitePasswordCommand,
      { eventId: s.eventId, password: 'a brand new pass' },
      a.ctx(),
      ports,
    );
    expect(await q(access)).toMatchObject({ state: 'locked' });
    expect(await codeOf(upload(access))).toBe('forbidden:locked');
    const fresh = await guestSiteAccess(a.org.id, s.eventId, 'a brand new pass');
    await executeCommand(
      saveGallerySettingsCommand,
      {
        eventId: s.eventId,
        enabled: false,
        moderation: 'hold',
        capBytes: null,
        guestQuotaBytes: null,
        guestQuotaItems: null,
      },
      a.ctx(),
      ports,
    );
    expect(await codeOf(upload(fresh))).toBe('invalid_state:gallery_closed');
    expect(
      await codeOf(
        executeQuery(publicSlidesQuery, { eventId: s.eventId, access: fresh }, visitor(a.org.id), ports),
      ),
    ).toBe('invalid_state:gallery_closed');

    const draft = await guestSiteScenario(a.org.id, { ctx: a.ctx(), publish: false });
    await enableGallery(a.ctx(), draft.eventId);
    expect(
      await codeOf(
        executeQuery(
          publicGalleryQuery,
          { eventId: draft.eventId, access: null, uploader: null },
          visitor(a.org.id),
          ports,
        ),
      ),
    ).toBe('not_found:site_unpublished');
  });

  it('a guest takes back their own items, never someone else’s', async () => {
    const g = await gallery(a, { moderation: 'auto' });
    const mine = await guestGalleryPhoto(a.org.id, { ...g, name: 'Lea' }, await image(200, 150));
    const theirs = await guestGalleryPhoto(a.org.id, { ...g, name: 'Tom' }, await image(200, 150));
    const remove = (uploader: string | null, itemId: string) =>
      runGalleryCommand(
        removeOwnGalleryItemCommand,
        { eventId: g.eventId, access: g.access, uploader, itemId },
        visitor(a.org.id),
        ports,
      );
    expect(await codeOf(remove(mine.uploader, theirs.itemId))).toBe('not_found');
    expect(await codeOf(remove(null, mine.itemId))).toBe('not_found');
    expect(await remove(mine.uploader, mine.itemId)).toMatchObject({ changed: 1 });
    expect((await host(a, g.eventId)).published.map((i) => i.id)).toEqual([theirs.itemId]);
    const live = await messages(a.org.id, g.eventId);
    expect(live.at(-1)?.data).toMatchObject({ itemId: mine.itemId, state: 'removed' });
  });
});

describe('signed file URLs', () => {
  it('serve a file while the signature is valid and the item exists; never a tampered, expired, foreign or removed one', async () => {
    const g = await gallery(a);
    const r = await hostGalleryPhoto(a.ctx(), g.eventId, await image(500, 400));
    const file = (await host(a, g.eventId)).published[0]?.files.find((f) => f.fallback);
    if (!file) throw new Error('expected a fallback file');
    const url = new URL(file.url, 'http://x');
    const [, , , , orgId, itemId, name] = url.pathname.split('/');
    const e = url.searchParams.get('e');
    const s = url.searchParams.get('s');
    const read = (o = orgId, i = itemId, n = name, ee = e, ss = s, now = new Date()) =>
      readGalleryFile(o ?? '', i ?? '', n ?? '', ee, ss, now);
    const ok = await read();
    expect(ok?.contentType).toBe('image/jpeg');
    expect(ok?.bytes.byteLength).toBeGreaterThan(0);
    expect(await read(orgId, itemId, name, e, `${s?.slice(0, -2)}AA`)).toBeNull();
    expect(await read(orgId, itemId, name, String(Number(e) + 1), s)).toBeNull();
    expect(await read(b.org.id)).toBeNull();
    expect(await read(orgId, itemId, name, e, s, new Date(Number(e) * 86_400_000 + 1))).toBeNull();
    await runGalleryCommand(
      removeGalleryItemCommand,
      { eventId: g.eventId, itemId: r.itemId },
      a.ctx(),
      ports,
    );
    expect(await read()).toBeNull();
  });
});

describe('gallery: isolation, permissions, impersonation, freeze', () => {
  it('isolation: another org never sees, changes or completes this org’s gallery', async () => {
    const g = await gallery(a);
    const p = await guestGalleryPhoto(a.org.id, { ...g, name: 'Iso' }, await image(100, 100));
    const ev = { eventId: g.eventId };
    expect(await codeOf(executeQuery(hostGalleryQuery, ev, b.ctx(), ports))).toBe('not_found');
    expect(
      await codeOf(
        executeCommand(
          moderateGalleryCommand,
          { ...ev, itemIds: [p.itemId], decision: 'approve' },
          b.ctx(),
          ports,
        ),
      ),
    ).toBe('not_found');
    expect(
      await codeOf(executeCommand(removeGalleryItemCommand, { ...ev, itemId: p.itemId }, b.ctx(), ports)),
    ).toBe('not_found');
    expect(
      await codeOf(
        executeCommand(requestGalleryUploadCommand, { ...ev, bytes: 10, caption: null }, b.ctx(), ports),
      ),
    ).toBe('not_found');
    // A guest of org A presenting their proof against org B's tenant finds nothing.
    expect(
      await codeOf(
        executeQuery(
          publicGalleryQuery,
          { eventId: g.eventId, access: g.access, uploader: p.uploader },
          visitor(b.org.id),
          ports,
        ),
      ),
    ).toBe('not_found');
    const rows = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute(sql`select id from gallery.items where event_id = ${g.eventId}`),
    );
    expect(rows).toHaveLength(0);
  });

  it('viewers read the gallery but change nothing; staff acting as a member cannot remove', async () => {
    const g = await gallery(a);
    const p = await guestGalleryPhoto(a.org.id, { ...g, name: 'View' }, await image(100, 100));
    const viewer = userCtx(a.viewerId, a.org.id);
    const ev = { eventId: g.eventId };
    expect((await executeQuery(hostGalleryQuery, ev, viewer, ports)).pending).toHaveLength(1);
    const writes = [
      () =>
        executeCommand(
          saveGallerySettingsCommand,
          {
            ...ev,
            enabled: false,
            moderation: 'auto',
            capBytes: null,
            guestQuotaBytes: null,
            guestQuotaItems: null,
          },
          viewer,
          ports,
        ),
      () =>
        executeCommand(
          moderateGalleryCommand,
          { ...ev, itemIds: [p.itemId], decision: 'approve' },
          viewer,
          ports,
        ),
      () => executeCommand(removeGalleryItemCommand, { ...ev, itemId: p.itemId }, viewer, ports),
      () => executeCommand(requestGalleryUploadCommand, { ...ev, bytes: 10, caption: null }, viewer, ports),
      () =>
        executeCommand(
          addGalleryVideoCommand,
          { ...ev, url: 'https://youtu.be/dQw4w9WgXcQ', caption: null },
          viewer,
          ports,
        ),
      () => executeCommand(completeGalleryUploadCommand, { ...ev, itemId: p.itemId }, viewer, ports),
    ];
    for (const w of writes) expect(await codeOf(w())).toBe('forbidden');
    const acting = a.ctx({ impersonatedBy: { staffUserId: uuidv7(), impersonationId: uuidv7() } });
    expect(
      await codeOf(executeCommand(removeGalleryItemCommand, { ...ev, itemId: p.itemId }, acting, ports)),
    ).toBe('impersonation_blocked:delete');
  });

  it('a read-only freeze refuses uploads and moderation; guests still see the gallery', async () => {
    const g = await gallery(a);
    await admin`select platform.set_ops_flag('read_only_freeze', ${JSON.stringify({ scope: 'orgs', orgIds: [a.org.id] })}::text::jsonb, 'test', 'test:gallery')`;
    try {
      expect(
        (
          await codeOf(
            executeCommand(
              requestGalleryUploadCommand,
              { eventId: g.eventId, bytes: 10, caption: null },
              a.ctx(),
              ports,
            ),
          )
        ).startsWith('read_only_freeze'),
      ).toBe(true);
      expect(
        (
          await codeOf(
            executeCommand(
              requestGuestGalleryUploadCommand,
              { eventId: g.eventId, access: g.access, uploader: null, name: 'F', bytes: 10, caption: null },
              visitor(a.org.id),
              ports,
            ),
          )
        ).startsWith('read_only_freeze'),
      ).toBe(true);
      expect(
        await executeQuery(
          publicGalleryQuery,
          { eventId: g.eventId, access: g.access, uploader: null },
          visitor(a.org.id),
          ports,
        ),
      ).toMatchObject({
        state: 'open',
      });
    } finally {
      await admin`select platform.set_ops_flag('read_only_freeze', null::jsonb, 'test', 'test:gallery')`;
    }
  });
});
