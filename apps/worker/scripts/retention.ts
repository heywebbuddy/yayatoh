import { closePools } from '@yayatoh/db';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { runRetention } from '../src/retention.ts';

// One retention pass now (the worker also runs it daily): `pnpm --filter @yayatoh/worker retention`.
setPlatformAuditSink(async (e) => console.info(JSON.stringify({ audit: 'platform_reader', ...e })));
console.info(JSON.stringify({ job: 'retention', ...(await runRetention()) }));
await closePools();
