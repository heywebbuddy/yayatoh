import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEoBmf } from '@yayatoh/donations';

/**
 * Owner-run job (M4.8b): download the IRS Exempt Organizations Business Master File extract (the
 * public bulk list staff verify charity profiles against) into `IRS_EO_BMF_DIR`. The admin app then
 * looks EINs up in these files (`bulkFileExemptOrgLookup`). Never run in tests or CI: they use the
 * recorded fixture. The IRS refreshes the files monthly; re-run it monthly.
 *
 *   IRS_EO_BMF_DIR=/data/irs pnpm --filter @yayatoh/worker irs-exempt-list
 */
const dir = process.env.IRS_EO_BMF_DIR;
if (!dir) {
  console.error('Set IRS_EO_BMF_DIR to the directory the files go to.');
  process.exit(1);
}
const BASE = 'https://www.irs.gov/pub/irs-soi/';
const FILES = ['eo1.csv', 'eo2.csv', 'eo3.csv', 'eo4.csv'];
await mkdir(dir, { recursive: true });
for (const f of FILES) {
  const res = await fetch(`${BASE}${f}`);
  if (!res.ok) throw new Error(`${f}: ${res.status}`);
  const text = await res.text();
  // Sanity check before replacing the previous copy: the layout parses and has rows.
  const sample = parseEoBmf(text.slice(0, 200_000).split('\n').slice(0, -1).join('\n'));
  if (sample.length === 0) throw new Error(`${f}: no rows parsed`);
  await writeFile(join(dir, f), text);
  console.info(JSON.stringify({ job: 'irs-exempt-list', file: f, bytes: text.length }));
}
