/**
 * Generates the media golden fixtures (M1.4e): small synthetic images (license-free, made here
 * from arithmetic patterns), a malicious SVG corpus, and — with `--golden` — the expected
 * variants of each ("golden queries": dimensions and SHA-256 of every file the pipeline makes).
 *
 *   pnpm --filter @yayatoh/media fixtures        # rewrite the fixture files
 *   pnpm --filter @yayatoh/media golden:update   # also rewrite fixtures/golden.json
 *
 * Re-run `golden:update` only on purpose (a sharp/libvips upgrade or a pipeline change), and
 * review the diff: the golden test fails whenever an encoder's output changes.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { processImage } from '../src/pipeline/process.ts';

const dir = join(import.meta.dirname, '..', 'fixtures');

function pattern(width: number, height: number, channels: 3 | 4): Buffer {
  const b = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      // Coarse bands compress well and still show real scaling.
      b[i] = Math.floor((x / width) * 8) * 32;
      b[i + 1] = Math.floor((y / height) * 8) * 32;
      b[i + 2] = ((Math.floor(x / 25) + Math.floor(y / 25)) % 2) * 200;
      if (channels === 4) b[i + 3] = x < width / 2 ? 255 : 96;
    }
  return b;
}

const raw = (w: number, h: number, c: 3 | 4) =>
  sharp(pattern(w, h, c), { raw: { width: w, height: h, channels: c } });

/** A PNG whose header claims 20000×20000 pixels (a decompression bomb's shape) with no real data. */
function bombPng(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(20000, 0);
  ihdr.writeUInt32BE(20000, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(64))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const RASTER_FIXTURES = [
  'banner.png',
  'photo-exif.jpg',
  'alpha.png',
  'still.gif',
  'small.webp',
  'tiny.avif',
  'logo.svg',
] as const;

const LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="240" height="80" viewBox="0 0 240 80">
  <title>Example logo</title>
  <defs>
    <linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#1d4ed8"/><stop offset="1" stop-color="#9333ea"/></linearGradient>
    <circle id="dot" r="12"/>
  </defs>
  <style>.mark { fill: url(#g); }</style>
  <rect class="mark" x="4" y="4" width="232" height="72" rx="16"/>
  <use xlink:href="#dot" x="40" y="40" fill="#ffffff"/>
  <text x="70" y="50" font-family="sans-serif" font-size="28" fill="#ffffff">yay</text>
</svg>
`;

/** The malicious corpus: every file must come out of the sanitizer inert (or be refused). */
export const MALICIOUS: Readonly<Record<string, string>> = {
  'script.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(document.cookie)</script><rect width="10" height="10"/></svg>`,
  'script-cdata.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script type="text/javascript"><![CDATA[ fetch('/steal?c=' + document.cookie) ]]></script><circle r="4" cx="5" cy="5"/></svg>`,
  'script-uppercase.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><SCRIPT>alert(1)</SCRIPT><svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(2)</svg:script><rect width="10" height="10"/></svg>`,
  'onload.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><rect width="10" height="10" onclick="alert(2)" ONMOUSEOVER="alert(3)"/></svg>`,
  'xlink-javascript.svg': `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><a xlink:href="javascript:alert(1)"><rect width="10" height="10"/></a><a href="java&#x09;script&#58;alert(2)"><circle r="3"/></a></svg>`,
  'use-external.svg': `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><use href="https://evil.example/sprite.svg#icon"/><use xlink:href="//evil.example/x.svg#a"/><use href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+#x"/><rect width="10" height="10"/></svg>`,
  'foreign-object.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><foreignObject width="10" height="10"><iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:alert(1)"></iframe><img xmlns="http://www.w3.org/1999/xhtml" src="x" onerror="alert(2)"/></foreignObject><rect width="10" height="10"/></svg>`,
  'entity-expansion.svg': `<?xml version="1.0"?>
<!DOCTYPE svg [
  <!ENTITY lol "lol">
  <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol9 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text x="0" y="9">&lol9;&xxe;</text></svg>`,
  'animate-href.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><a><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="href" values="javascript:alert(2)"/><rect width="10" height="10"/></a></svg>`,
  'external-image.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://evil.example/track.png" width="10" height="10"/><image href="file:///etc/passwd" width="1" height="1"/><rect width="10" height="10"/></svg>`,
  'css-exfil.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>@import url("https://evil.example/x.css"); rect { fill: url(https://evil.example/leak) } @font-face { font-family: x; src: url(https://evil.example/f.woff) }</style><rect width="10" height="10" style="background:url(https://evil.example/b)" fill="url(http://evil.example/p#g)" filter="url(https://evil.example/f#x)"/></svg>`,
  'stylesheet-pi.svg': `<?xml version="1.0"?><?xml-stylesheet href="https://evil.example/x.css" type="text/css"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>`,
  'fe-image.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><filter id="f"><feImage href="https://evil.example/x.png"/></filter><rect width="10" height="10" filter="url(#f)"/></svg>`,
  'iframe-embed.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><iframe src="https://evil.example"/><embed src="x.swf"/><object data="x"/><handler type="text/javascript">alert(1)</handler><rect width="10" height="10"/></svg>`,
};

export const REFUSED = {
  'bomb.png': 'too_many_pixels',
  'text.png': 'unsupported_type',
  'broken.svg': 'svg_malformed',
  'html.svg': 'unsupported_type',
} as const;

async function main() {
  const files: Record<string, Buffer> = {
    'banner.png': await raw(2000, 500, 3).png({ palette: true, compressionLevel: 9 }).toBuffer(),
    'photo-exif.jpg': await raw(640, 480, 3)
      .jpeg({ quality: 60 })
      .withExif({
        IFD0: { Copyright: 'YAYATOH-EXIF-CANARY', Make: 'CanaryCam', Model: 'Serial 0042' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '40/1 26/1 46/1',
          GPSLongitudeRef: 'W',
          GPSLongitude: '79/1 58/1 56/1',
        },
      })
      .withMetadata({ orientation: 6 })
      .toBuffer(),
    'alpha.png': await raw(300, 300, 4).png({ compressionLevel: 9 }).toBuffer(),
    'still.gif': await raw(120, 80, 3).gif().toBuffer(),
    'small.webp': await raw(200, 100, 3).webp({ quality: 60 }).toBuffer(),
    'tiny.avif': await raw(64, 64, 3).avif({ quality: 40 }).toBuffer(),
    'logo.svg': Buffer.from(LOGO_SVG),
    'bomb.png': bombPng(),
    'text.png': Buffer.from('This is plain text named like a PNG.\n'),
    'broken.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>'),
    'html.svg': Buffer.from('<html><body><script>alert(1)</script></body></html>'),
  };
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes);
  for (const [name, text] of Object.entries(MALICIOUS)) writeFileSync(join(dir, 'malicious', name), text);

  if (process.argv.includes('--golden')) {
    const golden: Record<string, unknown> = {};
    for (const name of RASTER_FIXTURES) {
      const out = await processImage(new Uint8Array(files[name] as Buffer));
      golden[name] = {
        sourceType: out.sourceType,
        width: out.width,
        height: out.height,
        variants: out.variants.map((v) => ({
          format: v.format,
          width: v.width,
          height: v.height,
          fallback: v.fallback,
          sha256: v.hash,
        })),
      };
    }
    writeFileSync(join(dir, 'golden.json'), `${JSON.stringify(golden, null, 2)}\n`);
  }
  console.info(`fixtures written to ${dir}`);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) await main();
