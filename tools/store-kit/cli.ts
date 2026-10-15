#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPS, type App, loadStore, REPO_ROOT, runChecks } from './src/app.ts';
import { placeholdersIn, renderPlaceholders } from './src/listing.ts';
import { shippedDependencies } from './src/privacy.ts';
import { checkShots } from './src/screenshots.ts';

/**
 * Store kit (M7.5a; runbook docs/runbooks/mobile-release.md).
 *
 *   store-kit privacy     --app mobile|staff [--list]   labels match the dependencies and permissions
 *   store-kit listing     --app …                       every locale within App Store and Play limits
 *   store-kit compliance  --app …                       export compliance, ratings, review notes
 *   store-kit screenshots --app …                       the capture plan matches its Maestro flows
 *   store-kit check       --app …                       all four
 *   store-kit shots       --app … [--dir d] [--locale en]  a finished capture folder has every PNG at its size
 *   store-kit render      --app … [--out dir]           fill ${NAME} placeholders from the environment
 *
 * It reads files and writes `store/dist/` only. It never contacts a store, Expo or EAS.
 */
const [command = 'check', ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? (rest[i + 1] ?? '') : undefined;
};
const app = flag('app') as App | undefined;
if (!app || !(APPS as readonly string[]).includes(app)) {
  console.error(
    `Usage: store-kit <privacy|listing|compliance|screenshots|shots|check|render> --app ${APPS.join('|')}`,
  );
  process.exit(2);
}

function report(results: Record<string, string[]>, only?: string): void {
  let failed = 0;
  for (const [name, errors] of Object.entries(results)) {
    if (only && name !== only) continue;
    if (errors.length === 0) console.info(`ok   ${app} ${name}`);
    else {
      failed += errors.length;
      console.error(`FAIL ${app} ${name}`);
      for (const e of errors) console.error(`  - ${e}`);
    }
  }
  if (failed > 0) process.exit(1);
}

if (command === 'privacy' && rest.includes('--list')) {
  console.info(JSON.stringify(shippedDependencies(REPO_ROOT, app), null, 2));
} else if (
  command === 'privacy' ||
  command === 'listing' ||
  command === 'compliance' ||
  command === 'screenshots'
) {
  report(runChecks(app), command);
} else if (command === 'check') {
  report(runChecks(app));
} else if (command === 'shots') {
  const s = loadStore(app);
  const dir = flag('dir') ?? join(s.dir, 'screenshots');
  const locale = flag('locale');
  const errors = checkShots(
    s.screenshots,
    (rel) => (existsSync(join(dir, rel)) ? new Uint8Array(readFileSync(join(dir, rel))) : null),
    locale ? [locale] : undefined,
  );
  report({ shots: errors }, 'shots');
} else if (command === 'render') {
  const s = loadStore(app);
  const names = placeholdersIn(s.apple, s.play, s.compliance);
  const out = flag('out') ?? join(s.dir, 'dist');
  try {
    const env = process.env;
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, 'store.config.json'),
      `${JSON.stringify(renderPlaceholders(s.apple, env), null, 2)}\n`,
    );
    writeFileSync(join(out, 'play.json'), `${JSON.stringify(renderPlaceholders(s.play, env), null, 2)}\n`);
    console.info(
      `Wrote ${join(out, 'store.config.json')} and play.json (${names.length} values from the environment).`,
    );
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
} else {
  console.error(`Unknown command ${command}`);
  process.exit(2);
}
