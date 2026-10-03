// Agency v2 on or off (M6.8b): pnpm --filter @yayatoh/worker agency-v2 -- --on|--off --reason "…"
import { parseArgs } from 'node:util';
import { databaseAuditSink, setPlatformAuditSink } from '@yayatoh/db/platform';
import { setAgencyV2 } from '../src/agency-v2.ts';

const { values } = parseArgs({
  // pnpm forwards a literal `--` separator; drop it.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    on: { type: 'boolean', default: false },
    off: { type: 'boolean', default: false },
    reason: { type: 'string', default: '' },
    by: { type: 'string', default: 'staff:cli' },
  },
});
if (values.on === values.off) {
  process.stderr.write('Give exactly one of --on or --off, and --reason "…"\n');
  process.exit(2);
}
// Every use lands in platform.access_log, like the staff console's.
setPlatformAuditSink(databaseAuditSink);
const changed = await setAgencyV2({
  enabled: values.on,
  by: values.by ?? 'staff:cli',
  reason: values.reason ?? '',
});
process.stdout.write(`agency v2 ${values.on ? 'on' : 'off'}${changed ? '' : ' (unchanged)'}\n`);
// One-shot CLI: exit rather than wait for idle pool connections to time out.
process.exit(0);
