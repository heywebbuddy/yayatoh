import { closePools } from '@yayatoh/db';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { runMetricsRebuild } from '../src/metrics.ts';

// Rebuild metric projections from the sources: `pnpm --filter @yayatoh/worker metrics:rebuild [-- --org <id>]`.
setPlatformAuditSink(async (e) => console.info(JSON.stringify({ audit: 'platform_reader', ...e })));
const i = process.argv.indexOf('--org');
const org = i > 0 ? process.argv[i + 1] : undefined;
console.info(
  JSON.stringify({ job: 'metrics-rebuild', ...(await runMetricsRebuild(org ? { onlyOrgs: [org] } : {})) }),
);
await closePools();
