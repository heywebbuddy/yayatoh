#!/usr/bin/env node
/**
 * Maestro journey inventory (M7.x).
 *
 *   node tools/check-maestro/cli.ts                      check both apps (CI)
 *   node tools/check-maestro/cli.ts --app staff          one app
 *   node tools/check-maestro/cli.ts --print-flows mobile:ios   the flows the EAS workflow runs, one per line
 *   node tools/check-maestro/cli.ts --table mobile       the journey table for docs/specs/M7.X/maestro.md
 *   --root <dir> reads another checkout (the tests use it)
 */
import { resolve } from 'node:path';
import {
  APPS,
  type App,
  checkAll,
  checkApp,
  ciFlows,
  formatProblems,
  journeyTable,
  type Platform,
} from './src/check.ts';

const args = process.argv.slice(2);
const value = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i > -1 ? args[i + 1] : undefined;
};
const root = resolve(value('--root') ?? '.');
const isApp = (x: string | undefined): x is App => APPS.includes(x as App);

const print = value('--print-flows');
if (print) {
  const [app, platform] = print.split(':');
  if (!isApp(app) || (platform !== 'ios' && platform !== 'android')) {
    console.error('usage: --print-flows <mobile|staff>:<ios|android>');
    process.exit(2);
  }
  for (const flow of ciFlows(root, app, platform as Platform)) console.info(flow);
  process.exit(0);
}

const table = value('--table');
if (table) {
  if (!isApp(table)) {
    console.error('usage: --table <mobile|staff>');
    process.exit(2);
  }
  console.info(journeyTable(root, table));
  process.exit(0);
}

const only = value('--app');
if (only !== undefined && !isApp(only)) {
  console.error('usage: --app <mobile|staff>');
  process.exit(2);
}
const problems = isApp(only) ? checkApp(root, only) : checkAll(root);
for (const line of formatProblems(problems)) console.error(line);
if (problems.length > 0) {
  console.error(`check-maestro: ${problems.length} problem(s)`);
  process.exit(1);
}
console.info('check-maestro: ok');
