import { readFileSync, writeFileSync } from 'node:fs';
import { openApiDocument } from '../src/app.ts';

// `write` refreshes the committed spec; `check` fails if it is stale. CI then runs oasdiff
// (breaking changes) against the base branch's copy of this file.
const path = new URL('../openapi.json', import.meta.url);
const next = `${JSON.stringify(openApiDocument(), null, 2)}\n`;
if (process.argv[2] === 'write') {
  writeFileSync(path, next);
  console.info('openapi.json written');
} else {
  let current = '';
  try {
    current = readFileSync(path, 'utf8');
  } catch {}
  if (current !== next) {
    console.error(
      'apps/api/openapi.json is stale. Run `pnpm --filter @yayatoh/api openapi:write` and commit it.',
    );
    process.exit(1);
  }
  console.info('openapi.json is up to date');
}
