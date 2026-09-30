import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

/** Test helpers: a generated PNG, and the committed golden fixtures by name. */
export async function testPng(width = 48, height = 32, color = '#3366cc'): Promise<Uint8Array> {
  const buf = await sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

export const MEDIA_FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');

export function mediaFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(MEDIA_FIXTURES_DIR, name)));
}
