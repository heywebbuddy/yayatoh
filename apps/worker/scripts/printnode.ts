// PrintNode per org (M5.5b, P5-2), run by platform staff once the org's PrintNode child account is
// open (creator reference = the org id):
//   pnpm --filter @yayatoh/worker printnode -- --org lakeside-events --on
//   pnpm --filter @yayatoh/worker printnode -- --org lakeside-events --off
import { parseArgs } from 'node:util';
import { setOrgPrintNode } from '../src/printers.ts';

const { values } = parseArgs({
  // pnpm forwards a literal `--` separator; drop it.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    org: { type: 'string' },
    on: { type: 'boolean', default: false },
    off: { type: 'boolean', default: false },
    by: { type: 'string', default: 'staff:cli' },
  },
});
if (!values.org) throw new Error('--org is required');
if (values.on === values.off) throw new Error('pass exactly one of --on or --off');
const r = await setOrgPrintNode(values.org, Boolean(values.on), values.by ?? 'staff:cli');
process.stdout.write(`printnode ${r.printnodeEnabled ? 'on' : 'off'}: ${values.org} → ${r.orgId}\n`);
// One-shot CLI: exit rather than wait for idle pool connections to time out.
process.exit(0);
