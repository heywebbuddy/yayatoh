#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { DumpMasker } from './src/mask.ts';
import { LEGACY_RULES } from './src/rules.ts';
import { Verifier } from './src/verify.ts';

/**
 * yayatoh legacy-mask — run on the owner's side, next to the production dump (see
 * docs/runbooks/legacy-export.md). Only the masked output ever leaves that machine.
 *
 *   node tools/legacy-mask/cli.ts keygen --out mask.key
 *   node tools/legacy-mask/cli.ts mask --in dump.sql[.gz] --out masked.sql[.gz] --key-file mask.key [--report report.json]
 *   node tools/legacy-mask/cli.ts verify --original dump.sql[.gz] --masked masked.sql[.gz]
 */
const [command, ...rest] = process.argv.slice(2).filter((a) => a !== '--');
const args = new Map<string, string>();
for (let i = 0; i < rest.length; i += 2) {
  const k = rest[i];
  const v = rest[i + 1];
  if (!k?.startsWith('--') || v === undefined) fail(`bad argument near "${k ?? ''}"`);
  args.set(k.slice(2), v);
}

function fail(message: string): never {
  console.error(`legacy-mask: ${message}`);
  process.exit(2);
}

const need = (name: string) => args.get(name) ?? fail(`--${name} is required`);
const input = (path: string) => {
  const s = createReadStream(path);
  return path.endsWith('.gz') ? s.pipe(createGunzip()) : s;
};

async function readText(path: string, onChunk: (s: string) => void) {
  const stream = input(path);
  stream.setEncoding('utf8');
  for await (const chunk of stream) onChunk(chunk as string);
}

if (command === 'keygen') {
  const out = need('out');
  if (existsSync(out)) fail(`${out} exists; refusing to overwrite a key`);
  writeFileSync(out, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  console.info(
    `legacy-mask: wrote a new 32-byte key to ${out} (keep it secret; never send it with the masked dump)`,
  );
} else if (command === 'mask') {
  const inPath = need('in');
  const outPath = need('out');
  if (resolve(inPath) === resolve(outPath)) fail('--out must differ from --in');
  if (existsSync(outPath)) fail(`${outPath} exists; refusing to overwrite`);
  const key = Buffer.from(readFileSync(need('key-file'), 'utf8').trim(), 'hex');
  const masker = new DumpMasker(key, LEGACY_RULES);
  const out = outPath.endsWith('.gz') ? createGzip() : null;
  const file = createWriteStream(outPath, { mode: 0o600 });
  const sink = out ?? file;
  const done = out ? pipeline(out, file) : null;
  const write = (s: string) =>
    s
      ? new Promise<void>((ok) => (sink.write(s) ? ok() : sink.once('drain', () => ok())))
      : Promise.resolve();
  const stream = input(inPath);
  stream.setEncoding('utf8');
  for await (const chunk of stream) await write(masker.push(chunk as string));
  await write(masker.end());
  sink.end();
  if (done) await done;
  else await new Promise<void>((ok) => file.once('finish', () => ok()));
  const reportPath = args.get('report');
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(masker.report, null, 2)}\n`);
  const t = masker.report.tables;
  const rows = Object.values(t).reduce((n, r) => n + r.rowsOut, 0);
  console.info(`legacy-mask: ${Object.keys(t).length} tables, ${rows} rows written to ${outPath}`);
  const unreviewed = Object.entries(t).filter(([, r]) => r.unreviewedText.length);
  if (unreviewed.length)
    console.info(
      `legacy-mask: text columns kept without a rule (review): ${unreviewed.map(([n, r]) => `${n}(${r.unreviewedText.join(',')})`).join(' ')}`,
    );
  if (masker.report.errors.length) {
    console.error(`legacy-mask: ${masker.report.errors.join('; ')}`);
    process.exit(1);
  }
} else if (command === 'verify') {
  const v = new Verifier(LEGACY_RULES);
  await readText(need('original'), (c) => v.pushOriginal(c));
  v.endOriginal();
  await readText(need('masked'), (c) => v.pushMasked(c));
  const r = v.result();
  for (const [table, c] of Object.entries(r.tables)) console.info(`${table}: ${c.original} → ${c.masked}`);
  if (!r.ok) {
    console.error(`legacy-mask verify: FAILED\n  ${[...new Set(r.problems)].join('\n  ')}`);
    process.exit(1);
  }
  console.info(
    'legacy-mask verify: OK — counts match, no original personal values survive, keys stay unique',
  );
} else {
  fail('usage: legacy-mask keygen|mask|verify (see the header of tools/legacy-mask/cli.ts)');
}
