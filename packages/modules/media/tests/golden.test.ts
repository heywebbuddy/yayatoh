import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { RASTER_FIXTURES, REFUSED } from '../scripts/make-fixtures.ts';
import { MediaRejected, processImage } from '../src/pipeline/process.ts';

/**
 * Golden transforms (roadmap M1.4: "Blob transforms pass the golden queries"): every fixture
 * becomes exactly the recorded variants — formats, dimensions and SHA-256 of each file.
 * A failure means an encoder's output changed: review it and run `golden:update` on purpose.
 */
const dir = join(import.meta.dirname, '..', 'fixtures');
const read = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
interface Golden {
  sourceType: string;
  width: number;
  height: number;
  variants: { format: string; width: number; height: number; fallback: boolean; sha256: string }[];
}
const golden = JSON.parse(readFileSync(join(dir, 'golden.json'), 'utf8')) as Record<string, Golden>;

describe('golden transforms', () => {
  it('covers every fixture', () => {
    expect(Object.keys(golden).sort()).toEqual([...RASTER_FIXTURES].sort());
  });

  it.each(RASTER_FIXTURES)('%s → the recorded variants', async (name) => {
    const out = await processImage(read(name));
    const want = golden[name] as Golden;
    expect({ sourceType: out.sourceType, width: out.width, height: out.height }).toEqual({
      sourceType: want.sourceType,
      width: want.width,
      height: want.height,
    });
    expect(
      out.variants.map((v) => ({
        format: v.format,
        width: v.width,
        height: v.height,
        fallback: v.fallback,
        sha256: v.hash,
      })),
    ).toEqual(want.variants);
    // Each variant really is the format and size it claims.
    for (const v of out.variants) {
      if (v.format === 'svg') continue;
      const m = await sharp(v.bytes).metadata();
      expect(m.format === 'heif' ? 'avif' : m.format).toBe(v.format);
      expect([m.width, m.height]).toEqual([v.width, v.height]);
    }
  });

  it('EXIF (with GPS) is applied to orientation, then stripped from every variant', async () => {
    const src = read('photo-exif.jpg');
    const srcMeta = await sharp(src).metadata();
    expect(srcMeta.exif).toBeDefined();
    expect(srcMeta.orientation).toBe(6);
    expect(Buffer.from(src).includes('YAYATOH-EXIF-CANARY')).toBe(true);
    const out = await processImage(src);
    // Orientation 6 = rotated: the 640×480 sensor image is shown 480×640.
    expect([out.width, out.height]).toEqual([480, 640]);
    for (const v of out.variants) {
      const m = await sharp(v.bytes).metadata();
      expect(m.exif).toBeUndefined();
      expect(m.xmp).toBeUndefined();
      expect(m.iptc).toBeUndefined();
      expect(m.icc).toBeUndefined();
      expect(m.orientation ?? 1).toBe(1);
      const raw = Buffer.from(v.bytes);
      expect(raw.includes('YAYATOH-EXIF-CANARY')).toBe(false);
      expect(raw.includes('CanaryCam')).toBe(false);
    }
  });

  it.each(Object.entries(REFUSED))('%s is refused (%s)', async (name, reason) => {
    await expect(processImage(read(name))).rejects.toMatchObject({ reason });
  });

  it('refuses more than 10 MB before decoding anything', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    await expect(processImage(big)).rejects.toBeInstanceOf(MediaRejected);
    await expect(processImage(big)).rejects.toMatchObject({ reason: 'too_large' });
  });

  it('refuses a truncated raster', async () => {
    const png = read('banner.png');
    await expect(processImage(png.subarray(0, 200))).rejects.toMatchObject({ reason: 'undecodable' });
  });
});
