import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildVectors, serialize } from './generate-vectors.ts';

/** `pnpm --filter @yayatoh/checkin-engine vectors:write` — regenerates `vectors/*.json`. */
const dir = fileURLToPath(new URL('../vectors/', import.meta.url));
mkdirSync(dir, { recursive: true });
const files = await buildVectors();
for (const [name, value] of Object.entries(files)) writeFileSync(`${dir}${name}`, serialize(value));
console.info(`wrote ${Object.keys(files).length} vector files to ${dir}`);
