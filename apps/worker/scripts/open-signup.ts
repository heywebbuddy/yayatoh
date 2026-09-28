// Open or close self-serve signup (M3.11a): pnpm --filter @yayatoh/worker open-signup -- --on|--off --reason "…"
import { parseArgs } from 'node:util';
import { databaseAuditSink, setPlatformAuditSink } from '@yayatoh/db/platform';
import { setOpenSignup } from '../src/open-signup.ts';

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
const changed = await setOpenSignup({
  enabled: values.on,
  by: values.by ?? 'staff:cli',
  reason: values.reason ?? '',
});
process.stdout.write(`open signup ${values.on ? 'on' : 'off'}${changed ? '' : ' (unchanged)'}\n`);
// One-shot CLI: exit rather than wait for idle pool connections to time out.
process.exit(0);
