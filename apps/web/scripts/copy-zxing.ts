// Copies the zxing-wasm QR reader into public/ under a content-hashed name, so the Scan PWA
// loads it from its own origin (and the service worker can cache it for offline use) instead
// of the package's default CDN. The client derives the same name from ZXING_WASM_SHA256.
import { createHash } from 'node:crypto';
import { copyFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = join(dirname(require.resolve('zxing-wasm/reader')), '..', '..', '..');
const source = join(pkgDir, 'dist', 'reader', 'zxing_reader.wasm');
const hash = createHash('sha256').update(readFileSync(source)).digest('hex');
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const name = `scan-zxing-${hash.slice(0, 16)}.wasm`;
for (const f of readdirSync(publicDir))
  if (/^scan-zxing-.*\.wasm$/.test(f) && f !== name) rmSync(join(publicDir, f));
copyFileSync(source, join(publicDir, name));
process.stdout.write(`zxing: public/${name}\n`);
