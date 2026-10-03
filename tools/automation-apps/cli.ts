import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GENERATED_DIR, GENERATED_FILES, generateApps, readOpenApi } from './src/index.ts';

/**
 * `node tools/automation-apps/cli.ts write|check` (M6.5c): generate the Make app and the n8n node
 * descriptions from `apps/api/openapi.json` into `tools/automation-apps/generated/`, or check
 * (CI, `pnpm contracts:check`) that the checked-in files are current and valid.
 */
const mode = process.argv[2];
if (mode !== 'write' && mode !== 'check') {
  console.error('usage: cli.ts write|check');
  process.exit(2);
}
const { text, problems } = generateApps(readOpenApi());
if (problems.length) {
  console.error(`automation apps: invalid\n${problems.join('\n')}`);
  process.exit(1);
}
let stale = 0;
for (const [key, rel] of Object.entries(GENERATED_FILES)) {
  const path = join(GENERATED_DIR, rel);
  const want = text[key as keyof typeof GENERATED_FILES];
  if (mode === 'write') {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, want);
  } else if (!existsSync(path) || readFileSync(path, 'utf8') !== want) {
    console.error(`automation apps: ${rel} is stale (run pnpm apps:generate)`);
    stale += 1;
  }
}
if (stale) process.exit(1);
process.stdout.write(mode === 'write' ? 'automation apps written\n' : 'automation apps: current and valid\n');
