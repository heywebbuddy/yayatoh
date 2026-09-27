import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { qrPath } from '../src/index.ts';

beforeAll(async () => {
  // Node has no fetch for the package's CDN default; hand it the bundled binary.
  const entry = createRequire(import.meta.url).resolve('zxing-wasm/reader');
  const wasm = readFileSync(join(dirname(entry), '..', '..', 'reader', 'zxing_reader.wasm'));
  await prepareZXingModule({
    overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) },
    fireImmediately: true,
  });
});

/** Rasterise the SVG path's unit squares into RGBA pixels, `scale` px per module. */
function raster(code: string, scale = 4) {
  const { size, d } = qrPath(code);
  const width = size * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const m of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const [x, y] = [Number(m[1]), Number(m[2])];
    for (let dy = 0; dy < scale; dy++)
      for (let dx = 0; dx < scale; dx++) {
        const i = ((y * scale + dy) * width + x * scale + dx) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
  }
  return { data, width, height: width, colorSpace: 'srgb' } as ImageData;
}

// The Scan PWA's camera fallback (iOS Safari) decodes with zxing-wasm: the codes we print and
// show must read back exactly with it.
describe('QR codes decode with the scanner fallback (zxing-wasm)', () => {
  it('reads a 139-character yy1 ticket code and a short code', async () => {
    const yy1 = `YY1${'A1B2C3D4E5F6G7H8'.repeat(9)}`.slice(0, 139);
    for (const code of [yy1, '7K3M9QX2']) {
      const [hit] = await readBarcodes(raster(code), { formats: ['QRCode'], maxNumberOfSymbols: 1 });
      expect(hit?.text).toBe(code);
    }
  });
});
