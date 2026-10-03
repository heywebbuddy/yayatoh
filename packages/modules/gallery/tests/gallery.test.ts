import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { isHeic } from '../src/domain/heic.ts';
import { clampLimit, GALLERY_LIMITS, quotaRefusal } from '../src/domain/limits.ts';
import {
  signDirectUpload,
  signFile,
  signUploader,
  verifyDirectUpload,
  verifyFile,
  verifyUploader,
} from '../src/domain/tokens.ts';
import { parseVideoLink, videoUrl } from '../src/domain/video.ts';
import { PublicGalleryDto } from '../src/dto.ts';
import { devHeicDecoder, linksOnlyVideoHost, videoHostFromEnv } from '../src/ports.ts';
import { fakeHeic } from '../src/testing.ts';

const SECRET = 'unit-test-secret-unit-test-secret';
const EV = '01900000-0000-7000-8000-000000000001';
const UP = '01900000-0000-7000-8000-000000000002';
const ORG = '01900000-0000-7000-8000-000000000003';

describe('quota (P4-6 placeholders)', () => {
  const facts = (eventBytes: number, guest: { bytes: number; items: number } | null = null) => ({
    eventBytes,
    eventItems: 0,
    capBytes: 1_000,
    guest: guest ? { ...guest, quotaBytes: 500, quotaItems: 2 } : null,
  });

  it('allows exactly the cap and refuses one byte over', () => {
    expect(quotaRefusal(facts(400), 600, true)).toBeNull();
    expect(quotaRefusal(facts(400), 601, true)).toBe('event_cap');
    expect(quotaRefusal(facts(1_000), 0, false)).toBeNull();
    expect(quotaRefusal(facts(1_000), 1, false)).toBe('event_cap');
  });

  it('checks the guest’s items, then bytes; hosts have no personal quota', () => {
    expect(quotaRefusal(facts(0, { bytes: 0, items: 2 }), 1, true)).toBe('guest_items');
    expect(quotaRefusal(facts(0, { bytes: 0, items: 2 }), 1, false)).toBeNull();
    expect(quotaRefusal(facts(0, { bytes: 400, items: 0 }), 101, true)).toBe('guest_bytes');
    expect(quotaRefusal(facts(0, { bytes: 400, items: 0 }), 100, true)).toBeNull();
    expect(quotaRefusal(facts(0), 999, true)).toBeNull();
  });

  it('the event cap wins over the guest quota; the largest upload and item count are fixed', () => {
    expect(quotaRefusal(facts(990, { bytes: 499, items: 1 }), 20, true)).toBe('event_cap');
    expect(
      quotaRefusal(
        { ...facts(0), capBytes: Number.MAX_SAFE_INTEGER },
        GALLERY_LIMITS.maxUploadBytes + 1,
        true,
      ),
    ).toBe('too_large');
    expect(quotaRefusal({ ...facts(0), eventItems: GALLERY_LIMITS.maxItemsPerEvent }, 1, true)).toBe(
      'event_items',
    );
  });

  it('a host may lower a limit, never raise it above the placeholder', () => {
    expect(clampLimit(null, 100)).toBe(100);
    expect(clampLimit(50, 100)).toBe(50);
    expect(clampLimit(500, 100)).toBe(100);
    expect(clampLimit(0, 100)).toBe(1);
    expect(clampLimit(Number.NaN, 100)).toBe(100);
  });
});

describe('video links only (P4-5)', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=10&utm_source=x', 'youtube', 'dQw4w9WgXcQ'],
    ['youtu.be/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://vimeo.com/76979871', 'vimeo', '76979871'],
    ['https://vimeo.com/76979871/abcdef', 'vimeo', '76979871'],
    ['https://player.vimeo.com/video/76979871', 'vimeo', '76979871'],
  ])('%s', (url, provider, videoId) => {
    expect(parseVideoLink(url)).toEqual({ provider, videoId });
  });

  it.each([
    '',
    'javascript:alert(1)',
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=tooshort',
    'https://youtube.com/@channel',
    'https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com:8443/watch?v=dQw4w9WgXcQ',
    'ftp://vimeo.com/123',
    'https://vimeo.com/channels/staffpicks',
    `https://youtu.be/${'a'.repeat(600)}`,
  ])('refuses %s', (url) => {
    expect(parseVideoLink(url)).toBeNull();
  });

  it('builds canonical links from the id only', () => {
    expect(videoUrl({ provider: 'youtube', videoId: 'dQw4w9WgXcQ' })).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    expect(videoUrl({ provider: 'vimeo', videoId: '1' })).toBe('https://vimeo.com/1');
  });

  it('the video host is links only until Stream is configured; the Stream stub refuses uploads', async () => {
    expect(videoHostFromEnv({})).toBe(linksOnlyVideoHost);
    expect(linksOnlyVideoHost.uploads).toBe(false);
    expect(() => videoHostFromEnv({ VIDEO_HOST: 'cloudflare_stream' })).toThrow(/account id/);
    const stub = videoHostFromEnv({
      VIDEO_HOST: 'cloudflare_stream',
      CLOUDFLARE_STREAM_ACCOUNT_ID: 'acct',
      CLOUDFLARE_STREAM_API_TOKEN: 'tok',
    });
    expect(stub).toMatchObject({ kind: 'cloudflare_stream', uploads: false });
    await expect(stub.createDirectUpload({ orgId: ORG, maxSeconds: 60 })).rejects.toThrow(/stub/);
  });
});

describe('HEIC (accepted through its port)', () => {
  const ftyp = (major: string, ...compat: string[]) => {
    const body = new TextEncoder().encode(`${major}\0\0\0\0${compat.join('')}`);
    const out = new Uint8Array(8 + body.length);
    new DataView(out.buffer).setUint32(0, out.length);
    out.set(new TextEncoder().encode('ftyp'), 4);
    out.set(body, 8);
    return out;
  };

  it('recognises HEIC/HEIF brands, never AVIF or other files', () => {
    expect(isHeic(ftyp('heic', 'mif1', 'heic'))).toBe(true);
    expect(isHeic(ftyp('mif1', 'heic'))).toBe(true);
    expect(isHeic(ftyp('heix', 'mif1'))).toBe(true);
    expect(isHeic(ftyp('avif', 'mif1', 'miaf'))).toBe(false);
    expect(isHeic(ftyp('mif1', 'avif'))).toBe(false);
    expect(isHeic(ftyp('isom', 'mp41'))).toBe(false);
    expect(isHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)]))).toBe(false);
    expect(isHeic(new Uint8Array(4))).toBe(false);
  });

  it('the dev decoder returns a test container’s picture and nothing for an empty one', async () => {
    const jpeg = new Uint8Array(
      await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } })
        .jpeg()
        .toBuffer(),
    );
    const heic = fakeHeic(jpeg);
    expect(isHeic(heic)).toBe(true);
    expect(await devHeicDecoder().decode(heic)).toEqual(jpeg);
    expect(await devHeicDecoder().decode(fakeHeic(new Uint8Array(0)).subarray(0, 24))).toBeNull();
  });
});

describe('signed strings', () => {
  it('uploader tokens are bound to the event and the secret', () => {
    const t = signUploader(EV, UP, SECRET);
    expect(verifyUploader(t, EV, SECRET)).toBe(UP);
    expect(verifyUploader(t, ORG, SECRET)).toBeNull();
    expect(verifyUploader(t, EV, `${SECRET}x`)).toBeNull();
    expect(verifyUploader(`${t}x`, EV, SECRET)).toBeNull();
    expect(verifyUploader(`not-a-uuid.${t.split('.')[1]}`, EV, SECRET)).toBeNull();
    expect(verifyUploader(null, EV, SECRET)).toBeNull();
  });

  it('file signatures last until the end of the next UTC day and name one file', () => {
    const now = new Date('2026-10-03T23:59:00Z');
    const { e, s } = signFile(ORG, UP, '640-abc.webp', now, SECRET);
    expect(verifyFile(ORG, UP, '640-abc.webp', String(e), s, now, SECRET)).toBe(true);
    expect(verifyFile(ORG, UP, '640-abc.webp', String(e), s, new Date('2026-10-04T23:59:59Z'), SECRET)).toBe(
      true,
    );
    expect(verifyFile(ORG, UP, '640-abc.webp', String(e), s, new Date('2026-10-05T00:00:00Z'), SECRET)).toBe(
      false,
    );
    expect(verifyFile(ORG, UP, '320-abc.webp', String(e), s, now, SECRET)).toBe(false);
    expect(verifyFile(ORG, UP, '640-abc.webp', String(e + 1), s, now, SECRET)).toBe(false);
    expect(verifyFile(ORG, UP, '640-abc.webp', null, s, now, SECRET)).toBe(false);
    // The same day signs the same URL (stable for caching).
    expect(signFile(ORG, UP, '640-abc.webp', new Date('2026-10-03T00:00:01Z'), SECRET)).toEqual({ e, s });
  });

  it('direct-upload tokens name the org, key and exact size, and expire', () => {
    const now = new Date('2026-10-03T12:00:00Z');
    const d = {
      orgId: ORG,
      key: `${ORG}/${UP}/u-${'a'.repeat(32)}`,
      bytes: 1234,
      exp: now.getTime() / 1000 + 60,
    };
    const t = signDirectUpload(d, SECRET);
    expect(verifyDirectUpload(t, now, SECRET)).toEqual(d);
    expect(verifyDirectUpload(t, new Date(now.getTime() + 61_000), SECRET)).toBeNull();
    expect(
      verifyDirectUpload(
        t.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
        now,
        SECRET,
      ),
    ).toBeNull();
    expect(verifyDirectUpload(t, now, `${SECRET}x`)).toBeNull();
  });
});

describe('the guest page allowlist', () => {
  it('a locked or closed gallery carries the event’s name alone', () => {
    const locked = PublicGalleryDto.parse({
      state: 'locked',
      eventName: 'Ana & Luis',
      published: [{ id: 'x' }],
    });
    expect(locked).toEqual({ state: 'locked', eventName: 'Ana & Luis' });
    const closed = PublicGalleryDto.parse({ state: 'closed', eventName: 'Ana & Luis', mine: [] });
    expect(closed).toEqual({ state: 'closed', eventName: 'Ana & Luis' });
  });
});
