import { writeFileSync } from 'node:fs';
import { closePools } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink } from '@yayatoh/db/platform';
import { parseSampleArgs, sampleAuditLog } from '../src/evidence.ts';

// Audit-log samples for the SOC 2 evidence (M5.11a).
//   CI (seeded database only):  pnpm --filter @yayatoh/worker audit-sample -- --out samples.json
//   Owner, production (docs/runbooks/evidence-production.md):
//     EVIDENCE_PRODUCTION_READ=owner-approved pnpm --filter @yayatoh/worker audit-sample -- \
//       --out samples.json --production --orgs slug-a,slug-b
// Every platform_reader read is recorded in platform.access_log.
let opts: ReturnType<typeof parseSampleArgs>;
try {
  opts = parseSampleArgs(process.argv.slice(2), process.env);
} catch (err) {
  console.error(`audit-sample: ${(err as Error).message}`);
  process.exit(2);
}
setPlatformAuditSink(databaseAuditSink);
const samples = await sampleAuditLog(opts);
writeFileSync(opts.out, `${JSON.stringify(samples, null, 2)}\n`, { mode: 0o600 });
console.info(
  `audit-sample (${samples.source}): ${samples.orgs.length} org(s), ${samples.orgs.reduce((n, o) => n + o.entries.length, 0)} entries → ${opts.out}`,
);
await closePools();
