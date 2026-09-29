import { writeFileSync } from 'node:fs';
import { closePools } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink } from '@yayatoh/db/platform';
import { assertLocalDatabase, sampleAuditLog } from '../src/evidence.ts';

// Audit-log samples for the SOC 2 evidence bundle (M5.11a), from the seeded CI database only:
//   pnpm --filter @yayatoh/worker audit-sample -- --out /path/audit-samples.json
// The platform_reader read is recorded in platform.access_log like every other.
const args = process.argv.slice(2).filter((a) => a !== '--');
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : undefined;
if (!out) {
  console.error('audit-sample: --out <file> is required');
  process.exit(2);
}
assertLocalDatabase([process.env.DATABASE_URL, process.env.PLATFORM_READER_DATABASE_URL]);
setPlatformAuditSink(databaseAuditSink);
const samples = await sampleAuditLog();
writeFileSync(out, `${JSON.stringify(samples, null, 2)}\n`);
console.info(
  `audit-sample: ${samples.orgs.length} org(s), ${samples.orgs.reduce((n, o) => n + o.entries.length, 0)} entries → ${out}`,
);
await closePools();
