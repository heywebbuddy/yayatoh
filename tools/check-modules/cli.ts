#!/usr/bin/env node
import { resolve } from 'node:path';
import { checkModules } from './src/check.ts';

const idx = process.argv.indexOf('--root');
const root = resolve(idx > -1 ? (process.argv[idx + 1] ?? '.') : '.');
const violations = checkModules(root);
for (const v of violations) console.error(`✗ [${v.rule}] ${v.file}: ${v.message}`);
if (violations.length > 0) {
  console.error(`check-modules: ${violations.length} violation(s)`);
  process.exit(1);
}
console.info('check-modules: ok');
