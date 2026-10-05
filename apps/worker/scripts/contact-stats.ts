import { closePools } from '@yayatoh/db';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { runContactStatsBackfill } from '../src/contact-stats.ts';

// Backfill contact stats (M6.1b) from the sources: `pnpm --filter @yayatoh/worker contact-stats [-- --org <id>]`.
setPlatformAuditSink(async (e) => console.info(JSON.stringify({ audit: 'platform_reader', ...e })));
const i = process.argv.indexOf('--org');
const org = i > 0 ? process.argv[i + 1] : undefined;
console.info(
  JSON.stringify({
    job: 'contact-stats',
    ...(await runContactStatsBackfill(org ? { onlyOrgs: [org] } : {})),
  }),
);
await closePools();
